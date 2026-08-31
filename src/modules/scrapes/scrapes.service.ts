import { env } from "../../config/env.js";
import { normalizeStudioSourceType, toStudioSourceType } from "../../db/source-type-compat.js";
import { studioDelete, studioGet, studioInsert, studioListSorted, studioUpdate } from "../../db/studio-client.js";
import type { EngagementType, Lead, ScrapeJob, ScrapeResultFilter, SourceType, XAccount } from "../../db/schema.js";
import { mapWithConcurrency } from "../../lib/concurrency.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { scrapeQueue } from "../../queue/queues.js";
import { logActivity } from "../activity/activity.service.js";
import { buildFilterPredicate } from "../lead-lists/filter-query-builder.js";
import { CANCELLED_ERROR_MESSAGE, isCancelledJob } from "./scrape-cancel.js";
import {
  attachScrapeResultSettings,
  clearScrapePauseRequest,
  clearScrapeResumeAt,
  createScrapeResultStore,
  deleteScrapeResultStore,
  getScrapeResultStore,
  requestScrapeFinishRow,
  requestScrapePauseRow,
  scrapeResultCapLeads,
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
  /**
   * Handles already collected from this target, so a continued run scrolls past them rather than
   * re-collecting them. Set only by `continueScrapeJob` — never accepted from a request body.
   */
  skipHandles?: string[];
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

  const capLeads = input.capLeads ?? env.SCRAPE_CAP_LEADS_DEFAULT;
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
    const store = await createScrapeResultStore(
      userId,
      normalizedJob.id,
      input.resultFilterDefinition ?? {},
      capLeads
    );
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
      capLeads,
      resultFilter: input.resultFilterDefinition,
      skipHandles: input.skipHandles,
    },
    { jobId: job.id }
  );

  return job;
}

/**
 * Ceiling on how many already-collected handles a resumed or continued run is told to scroll past.
 *
 * Every one of them costs the run a little scrolling and nothing else, so a generous bound is
 * cheap — but it rides on the BullMQ job payload and is held in memory as a Set for the whole run,
 * so it is bounded rather than unbounded.
 */
const MAX_SKIP_HANDLES = 5000;

/**
 * The handles this user has already collected from a given target.
 *
 * This is what makes "continue" mean *more* leads rather than the same page again. Read from the
 * leads table by (sourceType, sourceRef) rather than from one job's membership, because the point
 * is "everything I already have from this target", however many runs it took to get it.
 */
async function collectedHandlesFor(userId: string, sourceType: SourceType, sourceRef: string): Promise<string[]> {
  const leads = await studioListSorted<Lead>(
    "leads",
    { filter: { userId, sourceType: toStudioSourceType(sourceType), sourceRef }, cap: MAX_SKIP_HANDLES },
    (a, b) => a.id.localeCompare(b.id)
  );
  return leads.map((lead) => lead.handle.toLowerCase());
}

/** The cap a job was created with, falling back for jobs that predate it being recorded. */
async function capLeadsFor(userId: string, scrapeJobId: string): Promise<number> {
  return scrapeResultCapLeads(await getScrapeResultStore(userId, scrapeJobId)) ?? env.SCRAPE_CAP_LEADS_DEFAULT;
}

async function requireRunnableAccount(userId: string, xAccountId: string): Promise<XAccount> {
  const account = await studioGet<XAccount>("x_accounts", xAccountId);
  if (!account || account.userId !== userId) throw new NotFoundError("X account not found");
  if (account.status !== "active") {
    throw new ValidationError(`X account is ${account.status}, cannot run a scrape on it`);
  }
  return account;
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

/**
 * "That's enough — wrap up with what you have."
 *
 * Distinct from a cancel: the run stops looking for more at its next checkpoint, but everything it
 * found is kept and the job completes normally rather than ending as cancelled. Only meaningful
 * while a job is actually running; a queued one hasn't collected anything, so there is nothing to
 * wrap up and cancelling is the honest action.
 */
export async function finishScrapeJobEarly(userId: string, id: string) {
  const job = await getScrapeJob(userId, id);
  if (job.status !== "running") {
    throw new ValidationError(
      job.status === "queued"
        ? "This scrape hasn't started yet — cancel it instead"
        : `This scrape is already ${job.status}`
    );
  }

  await requestScrapeFinishRow(userId, id);
  await logActivity(userId, "scrape.finish_requested", { scrapeJobId: id });
  return getScrapeJob(userId, id);
}

/**
 * "Stop, but I'm not done with this."
 *
 * The third way a run can be stopped, and the only one it survives: a cancel is terminal and a
 * finish completes the job, while a pause leaves it `paused` with every lead it had and a way back
 * onto the queue. A queued job never started, so it is simply taken off the queue and parked; a
 * running one gets a request row the worker notices at its next checkpoint, exactly like "Finish
 * now" — the same mechanism, a different ending.
 */
export async function pauseScrapeJob(userId: string, id: string) {
  const job = await getScrapeJob(userId, id);
  if (job.status !== "queued" && job.status !== "running") {
    throw new ValidationError(
      job.status === "paused" ? "This scrape is already paused" : `This scrape is already ${job.status}`
    );
  }

  if (job.status === "queued") {
    const bullJob = await scrapeQueue.getJob(id);
    if (bullJob) {
      const state = await bullJob.getState();
      // An active job's lock belongs to the worker holding it — removing it here throws. It also
      // means the job started between the read above and now, so fall through to the request row,
      // which is the right signal for a running job anyway.
      if (state === "waiting" || state === "delayed") await bullJob.remove();
    }
    const updated = await studioUpdate<ScrapeJob>("scrape_jobs", id, {
      status: "paused",
      errorMessage: "Paused before it started. Resume to put it back on the queue.",
    });
    await logActivity(userId, "scrape.paused", { scrapeJobId: id, wasRunning: false });
    return attachScrapeResultSettings(normalizeStudioSourceType(updated), await getScrapeResultStore(userId, id));
  }

  await requestScrapePauseRow(userId, id);
  await logActivity(userId, "scrape.pause_requested", { scrapeJobId: id });
  return getScrapeJob(userId, id);
}

/**
 * Puts a paused scrape back on the queue, carrying on rather than starting over.
 *
 * The same job row is reused — its leads, its filter and its membership all stay attached — and the
 * run is handed every handle already collected from this target so it scrolls past them instead of
 * spending its budget re-reading profiles that are already on file. That is what makes resuming
 * worth more than triggering a fresh scrape of the same list.
 *
 * Deliberately indifferent to *why* the job was paused. A manual pause, a rate limit, and a daily
 * quota all leave a job in the same state with the same thing needed from it, and a job resumed
 * while its account is still resting is not a problem: the worker sees the cooldown and delays the
 * job until it lifts, which is the behaviour that already makes a throttled scrape self-healing.
 */
export async function resumeScrapeJob(userId: string, id: string) {
  const job = await getScrapeJob(userId, id);
  if (job.status !== "paused") {
    throw new ValidationError(
      job.status === "queued" || job.status === "running"
        ? "This scrape is already running"
        : `Only a paused scrape can be resumed — this one is ${job.status}`
    );
  }
  await requireRunnableAccount(userId, job.xAccountId);

  const [capLeads, skipHandles] = await Promise.all([
    capLeadsFor(userId, id),
    collectedHandlesFor(userId, job.sourceType, job.sourceRef),
  ]);

  // The pause request has to go before the job does, or the resumed run reads the row it was
  // stopped by and pauses itself again at its first checkpoint.
  await clearScrapePauseRequest(userId, id);
  await clearScrapeResumeAt(userId, id);

  // BullMQ keeps completed/failed jobs around for a week and refuses a second job with the same
  // id, so the old one is removed before the new one takes its place. Reusing the id keeps
  // `scrapeQueue.getJob(job.id)` working for cancel and delete, which both look it up that way.
  const existing = await scrapeQueue.getJob(id);
  if (existing) {
    const state = await existing.getState();
    if (state === "active") throw new ValidationError("This scrape is still stopping — try again in a few seconds");
    await existing.remove();
  }

  const updated = await studioUpdate<ScrapeJob>("scrape_jobs", id, {
    status: "queued",
    errorMessage: null,
    finishedAt: null,
  });

  await scrapeQueue.add(
    "scrape",
    {
      scrapeJobId: id,
      userId,
      xAccountId: job.xAccountId,
      sourceType: job.sourceType as CreateScrapeInput["sourceType"],
      sourceRef: job.sourceRef,
      engagementTypes: job.engagementTypes ?? undefined,
      capLeads,
      resultFilter: Object.keys(job.resultFilterDefinition).length > 0 ? job.resultFilterDefinition : undefined,
      skipHandles,
    },
    { jobId: id }
  );

  await logActivity(userId, "scrape.resumed", { scrapeJobId: id, skipHandles: skipHandles.length });
  return attachScrapeResultSettings(normalizeStudioSourceType(updated), await getScrapeResultStore(userId, id));
}

/**
 * Runs the same target again for more leads, as a new job.
 *
 * The counterpart to resume, for a scrape that is over rather than paused: a completed run that
 * stopped short of its cap, or a cancelled one. It copies the target, the cap and the filter, and
 * hands the new run every handle already collected from that target, so "continue" produces
 * another `capLeads` accounts that are actually new instead of the same first page again.
 *
 * A new row rather than a reused one because the old job is a finished record — its leads,
 * membership and result view all belong to the run that produced them, and overwriting that in
 * place would make a scrape's own results table stop meaning "what this run found".
 */
export async function continueScrapeJob(userId: string, id: string) {
  const job = await getScrapeJob(userId, id);
  if (job.status === "queued" || job.status === "running") {
    throw new ValidationError("This scrape is still going — pause or stop it first");
  }
  if (job.status === "paused") {
    throw new ValidationError("This scrape is paused — resume it instead, so it keeps its leads");
  }
  if (job.sourceType === "likers") {
    throw new ValidationError("X made likers private in June 2024, so this scrape can no longer be run");
  }
  await requireRunnableAccount(userId, job.xAccountId);

  const [capLeads, skipHandles] = await Promise.all([
    capLeadsFor(userId, id),
    collectedHandlesFor(userId, job.sourceType, job.sourceRef),
  ]);

  return createScrapeJob(userId, {
    xAccountId: job.xAccountId,
    sourceType: job.sourceType,
    sourceRef: job.sourceRef,
    engagementTypes: job.engagementTypes ?? undefined,
    capLeads,
    resultFilterDefinition:
      Object.keys(job.resultFilterDefinition).length > 0 ? job.resultFilterDefinition : undefined,
    skipHandles,
  });
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
