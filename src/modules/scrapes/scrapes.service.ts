import { and, desc, eq } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { scrapeJobs, xAccounts } from "../../db/schema.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { scrapeQueue } from "../../queue/queues.js";

export interface CreateScrapeInput {
  xAccountId: string;
  sourceType: "search" | "followers" | "likers";
  sourceRef: string;
  capLeads?: number;
}

export async function createScrapeJob(userId: string, input: CreateScrapeInput) {
  const account = await db.query.xAccounts.findFirst({
    where: and(eq(xAccounts.id, input.xAccountId), eq(xAccounts.userId, userId)),
  });
  if (!account) throw new NotFoundError("X account not found");
  if (account.status !== "active") {
    throw new ValidationError(`X account is ${account.status}, cannot trigger a scrape`);
  }

  const [job] = await db
    .insert(scrapeJobs)
    .values({
      userId,
      xAccountId: input.xAccountId,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      status: "queued",
    })
    .returning();

  await scrapeQueue.add(
    "scrape",
    {
      scrapeJobId: job.id,
      userId,
      xAccountId: input.xAccountId,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
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
  const conditions = [eq(scrapeJobs.userId, userId)];
  if (options.status) conditions.push(eq(scrapeJobs.status, options.status));
  if (options.xAccountId) conditions.push(eq(scrapeJobs.xAccountId, options.xAccountId));

  return db.query.scrapeJobs.findMany({
    where: and(...conditions),
    orderBy: desc(scrapeJobs.createdAt),
  });
}

export async function getScrapeJob(userId: string, id: string) {
  const job = await db.query.scrapeJobs.findFirst({
    where: and(eq(scrapeJobs.id, id), eq(scrapeJobs.userId, userId)),
  });
  if (!job) throw new NotFoundError("Scrape job not found");
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
    const [updated] = await db
      .update(scrapeJobs)
      .set({ status: "failed", errorMessage: "Cancelled by user", finishedAt: new Date() })
      .where(and(eq(scrapeJobs.id, id), eq(scrapeJobs.userId, userId)))
      .returning();
    return updated;
  }

  // Already running/terminal: best-effort only, can't hard-kill an in-flight Playwright run.
  return job;
}
