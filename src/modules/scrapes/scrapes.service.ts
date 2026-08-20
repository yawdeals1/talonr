import { env } from "../../config/env.js";
import { normalizeStudioSourceType, toStudioSourceType } from "../../db/source-type-compat.js";
import { studioDelete, studioGet, studioInsert, studioListSorted, studioUpdate } from "../../db/studio-client.js";
import type { EngagementType, Lead, ScrapeJob, ScrapeResultFilter, XAccount } from "../../db/schema.js";
import { mapWithConcurrency } from "../../lib/concurrency.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { scrapeQueue } from "../../queue/queues.js";
import { logActivity } from "../activity/activity.service.js";
import { buildFilterPredicate } from "../lead-lists/filter-query-builder.js";
import { CANCELLED_ERROR_MESSAGE, isCancelledJob } from "./scrape-cancel.js";
import {
  attachScrapeResultSettings,
  createScrapeResultStore,
  deleteScrapeResultStore,
  getScrapeResultStore,
  scrapeResultLeadIds,
  updateScrapeResultStoreFilter,
} from "./scrape-results.service.js";

export interface CreateScrapeInput {
  xAccountId: string;
  sourceType: "search" | "followers" | "engagers";
  sourceRef: string;
  engagementTypes?: EngagementType[];
  capLeads?: number;
  resultFilterDefinition?: ScrapeResultFilter;
}

// Tie-broken by id so the ordering is total — the Studio API has no ORDER BY, so paged fetches
// arrive arbitrarily ordered. See leads.service.ts#compareLeadsForDisplay.
const byCreatedAtDesc = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

export async function createScrapeJob(userId: string, input: CreateScrapeInput) {
  const account = await studioGet<XAccount>("x_accounts", input.xAccountId);
  if (!account || account.userId !== userId) throw new NotFoundError("X account not found");
  if (account.status !== "active") {
    throw new ValidationError(`X account is ${account.status}, cannot trigger a scrape`);
  }

  const storedJob = await studioInsert<ScrapeJob>("scrape_jobs", {
    userId,
    xAccountId: input.xAccountId,
    sourceType: toStudioSourceType(input.sourceType),
    sourceRef: input.sourceRef,
    status: "queued",
  });
  const normalizedJob = normalizeStudioSourceType(storedJob);
  let job: ScrapeJob;
  try {
    const store = await createScrapeResultStore(userId, normalizedJob.id, input.resultFilterDefinition ?? {});
    job = attachScrapeResultSettings(normalizedJob, store);
  } catch (error) {
    await studioDelete("scrape_jobs", normalizedJob.id);
    throw error;
  }

  await scrapeQueue.add(
    "scrape",
    {
      scrapeJobId: job.id,
      userId,
      xAccountId: input.xAccountId,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      engagementTypes: input.engagementTypes,
      capLeads: input.capLeads ?? env.SCRAPE_CAP_LEADS_DEFAULT,
      resultFilter: input.resultFilterDefinition,
    },
    { jobId: job.id }
  );

  return job;
}

export interface ListScrapesOptions {
  status?: "queued" | "running" | "completed" | "failed" | "paused";
  xAccountId?: string;
}

export async function listScrapeJobs(userId: string, options: ListScrapesOptions) {
  const jobs = await studioListSorted<ScrapeJob>(
    "scrape_jobs",
    {
      filter: {
        userId,
        ...(options.status ? { status: options.status } : {}),
        ...(options.xAccountId ? { xAccountId: options.xAccountId } : {}),
      },
    },
    byCreatedAtDesc
  );
  return mapWithConcurrency(jobs.map(normalizeStudioSourceType), 8, async (job) =>
    attachScrapeResultSettings(job, await getScrapeResultStore(userId, job.id))
  );
}

export async function getScrapeJob(userId: string, id: string) {
  const job = await studioGet<ScrapeJob>("scrape_jobs", id);
  if (!job || job.userId !== userId) throw new NotFoundError("Scrape job not found");
  const normalized = normalizeStudioSourceType(job);
  return attachScrapeResultSettings(normalized, await getScrapeResultStore(userId, id));
}

export async function updateScrapeResultFilter(userId: string, id: string, filter: ScrapeResultFilter) {
  const job = await getScrapeJob(userId, id);
  const store = await updateScrapeResultStoreFilter(userId, id, filter);
  if (!store) throw new ValidationError("Exact lead tracking is unavailable for this older scrape");
  return attachScrapeResultSettings(job, store);
}

export async function listScrapeJobLeads(userId: string, id: string, page = 1, pageSize = 50) {
  const job = await getScrapeJob(userId, id);
  const size = Math.min(pageSize, 200);
  if (!job.tracksExactLeads) {
    return { scrapeJob: job, leads: [], page, pageSize: size, total: 0, exactMembershipAvailable: false };
  }

  const store = await getScrapeResultStore(userId, id);
  if (!store) {
    return { scrapeJob: job, leads: [], page, pageSize: size, total: 0, exactMembershipAvailable: false };
  }
  const fetched = await mapWithConcurrency(scrapeResultLeadIds(store), 8, (leadId) => studioGet<Lead>("leads", leadId));
  const candidates = fetched
    .filter((lead): lead is Lead => lead !== null && lead.userId === userId)
    .map(normalizeStudioSourceType);
  const matched = candidates.filter(buildFilterPredicate(job.resultFilterDefinition ?? {}));
  const start = (page - 1) * size;

  return {
    scrapeJob: job,
    leads: matched.slice(start, start + size),
    page,
    pageSize: size,
    total: matched.length,
    exactMembershipAvailable: true,
  };
}

/**
 * Cancels a scrape, whether it has started or not.
 *
 * A queued job is pulled straight out of the BullMQ queue. A *running* job can't be killed from
 * this process — the Playwright run lives in the worker — so the job row is marked cancelled here
 * and the worker stops itself at its next checkpoint (see scrape-cancel.ts#createCancellationCheck),
 * saving whatever it had already collected. Writing the row first rather than signalling the worker
 * and waiting means the cancel sticks even if that worker is wedged or gets restarted: the run can
 * never come back, because the processor re-reads this row before it does anything.
 */
export async function cancelScrapeJob(userId: string, id: string) {
  const job = await getScrapeJob(userId, id);

  if (job.status !== "queued" && job.status !== "running") {
    throw new ValidationError(`This scrape is already ${job.status} and cannot be cancelled`);
  }

  const bullJob = await scrapeQueue.getJob(id);
  if (bullJob) {
    const state = await bullJob.getState();
    // An active job's lock belongs to the worker holding it; removing it here would throw. The
    // status write below is what stops that one, and the worker takes it off the queue itself.
    if (state === "waiting" || state === "delayed") {
      await bullJob.remove();
    }
  }

  const updated = await studioUpdate<ScrapeJob>("scrape_jobs", id, {
    status: "failed",
    errorMessage: CANCELLED_ERROR_MESSAGE,
    finishedAt: new Date(),
  });
  await logActivity(userId, "scrape.cancelled", { scrapeJobId: id, wasRunning: job.status === "running" });
  return attachScrapeResultSettings(normalizeStudioSourceType(updated), await getScrapeResultStore(userId, id));
}

export async function deleteScrapeJob(userId: string, id: string): Promise<void> {
  const job = await getScrapeJob(userId, id);
  if (job.status === "running") {
    throw new ValidationError("A running scrape cannot be deleted");
  }

  const bullJob = await scrapeQueue.getJob(id);
  if (bullJob) {
    const state = await bullJob.getState();
    if (state === "active") {
      // A just-cancelled job stays active until the worker reaches its next checkpoint, so this
      // is a wait-a-moment, not a refusal — say which one it is.
      throw new ValidationError(
        isCancelledJob(job)
          ? "This scrape is still stopping — try again in a few seconds"
          : "A running scrape cannot be deleted"
      );
    }
    await bullJob.remove();
  }

  await deleteScrapeResultStore(userId, id);
  await studioDelete("scrape_jobs", id);
}

export async function deleteScrapeJobs(userId: string, ids: string[]): Promise<number> {
  const uniqueIds = [...new Set(ids)];
  const jobs = await mapWithConcurrency(uniqueIds, 8, (id) => getScrapeJob(userId, id));
  if (jobs.some((job) => job.status === "running")) {
    throw new ValidationError("Running scrapes cannot be deleted");
  }

  const queuedJobs = await mapWithConcurrency(uniqueIds, 8, (id) => scrapeQueue.getJob(id));
  const states = await mapWithConcurrency(queuedJobs, 8, (job) => job?.getState() ?? Promise.resolve("missing"));
  if (states.includes("active")) throw new ValidationError("Running scrapes cannot be deleted");

  await mapWithConcurrency(queuedJobs, 8, async (job) => {
    if (job) await job.remove();
  });
  await mapWithConcurrency(uniqueIds, 8, (id) => deleteScrapeResultStore(userId, id));
  await mapWithConcurrency(uniqueIds, 8, (id) => studioDelete("scrape_jobs", id));
  return uniqueIds.length;
}
