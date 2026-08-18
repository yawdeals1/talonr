import { env } from "../../config/env.js";
import {
  studioGet,
  studioInsert,
  studioListSorted,
  studioTableHasColumn,
  studioUpdate,
} from "../../db/studio-client.js";
import type { EngagementType, ScrapeJob, XAccount } from "../../db/schema.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
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

  const insertValues: Record<string, unknown> = {
    userId,
    xAccountId: input.xAccountId,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    status: "queued",
  };

  // The queue payload below is the worker's source of truth. Keep the database write compatible
  // with deployments where this newer optional column has not landed yet; once it appears in the
  // live Studio schema, the selected strategies are persisted on the job row as well.
  let canPersistEngagementTypes = false;
  try {
    canPersistEngagementTypes = await studioTableHasColumn("scrape_jobs", "engagement_types");
  } catch (err) {
    // This lookup only controls persistence of optional metadata; it must not prevent the queue
    // job (which contains the same strategies) from being created during a transient spec outage.
    logger.warn({ err }, "could not inspect scrape_jobs schema; omitting optional engagement_types");
  }
  if (canPersistEngagementTypes) {
    insertValues.engagementTypes = input.engagementTypes ?? null;
  }

  const job = await studioInsert<ScrapeJob>("scrape_jobs", insertValues);

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
  return studioListSorted<ScrapeJob>(
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
}

export async function getScrapeJob(userId: string, id: string) {
  const job = await studioGet<ScrapeJob>("scrape_jobs", id);
  if (!job || job.userId !== userId) throw new NotFoundError("Scrape job not found");
  return job;
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
    return studioUpdate<ScrapeJob>("scrape_jobs", id, {
      status: "failed",
      errorMessage: "Cancelled by user",
      finishedAt: new Date(),
    });
  }

  // Already running/terminal: best-effort only, can't hard-kill an in-flight Playwright run.
  return job;
}
