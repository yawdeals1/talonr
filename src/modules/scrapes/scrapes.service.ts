import { env } from "../../config/env.js";
import { normalizeStudioSourceType, toStudioSourceType } from "../../db/source-type-compat.js";
import { studioDelete, studioGet, studioInsert, studioListSorted, studioUpdate } from "../../db/studio-client.js";
import type { EngagementType, ScrapeJob, XAccount } from "../../db/schema.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { scrapeQueue } from "../../queue/queues.js";

export interface CreateScrapeInput {
  xAccountId: string;
  sourceType: "search" | "followers" | "engagers";
  sourceRef: string;
  engagementTypes?: EngagementType[];
  capLeads?: number;
}

const byCreatedAtDesc = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt);

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
  const job = normalizeStudioSourceType(storedJob);

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
  return jobs.map(normalizeStudioSourceType);
}

export async function getScrapeJob(userId: string, id: string) {
  const job = await studioGet<ScrapeJob>("scrape_jobs", id);
  if (!job || job.userId !== userId) throw new NotFoundError("Scrape job not found");
  return normalizeStudioSourceType(job);
}

export async function cancelScrapeJob(userId: string, id: string) {
  const job = await getScrapeJob(userId, id);

  const bullJob = await scrapeQueue.getJob(id);
  if (bullJob) {
    const state = await bullJob.getState();
    if (state === "waiting" || state === "delayed") {
      await bullJob.remove();
    }
  }

  if (job.status === "queued") {
    const updated = await studioUpdate<ScrapeJob>("scrape_jobs", id, {
      status: "failed",
      errorMessage: "Cancelled by user",
      finishedAt: new Date(),
    });
    return normalizeStudioSourceType(updated);
  }

  // Already running/terminal: best-effort only, can't hard-kill an in-flight Playwright run.
  return job;
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
      throw new ValidationError("A running scrape cannot be deleted");
    }
    await bullJob.remove();
  }

  await studioDelete("scrape_jobs", id);
}
