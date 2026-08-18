import { DelayedError, Worker } from "bullmq";
import { env } from "../../config/env.js";
import { studioGet, studioUpdate } from "../../db/studio-client.js";
import type { EngagementType, ScrapeJob, XAccount } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";
import { logActivity } from "../../modules/activity/activity.service.js";
import { upsertLeads } from "../../modules/leads/leads.service.js";
import { closeScrapeSession, launchScrapeSession } from "../../scraper/browser.js";
import { enrichLeadsFromProfiles } from "../../scraper/profile-enricher.js";
import { decryptProxy, decryptSession } from "../../scraper/session-store.js";
import { scrollAndCollect } from "../../scraper/scroll-collector.js";
import { followersSource } from "../../scraper/sources/followers.source.js";
import { repliersSource } from "../../scraper/sources/repliers.source.js";
import { retweetersSource } from "../../scraper/sources/retweeters.source.js";
import { searchSource } from "../../scraper/sources/search.source.js";
import { isAccountHealthError, type RawLead, type ScrapeSource } from "../../scraper/types.js";
import { redisConnection } from "../connection.js";
import { SCRAPE_QUEUE_NAME, type ScrapeJobData } from "../queues.js";
import { acquireAccountSlot, releaseAccountSlot } from "../rate-limit/account-semaphore.js";
import { tryConsumeDailyQuota } from "../rate-limit/daily-quota.js";

const SOURCES: Record<"search" | "followers", ScrapeSource> = {
  search: searchSource,
  followers: followersSource,
};

// "engagers" isn't a single ScrapeSource — it's one or more of these, run in sequence and
// merged (see runScrape below), since replies and retweets need different pages/extractors.
const ENGAGEMENT_SOURCES: Record<EngagementType, ScrapeSource> = {
  repliers: repliersSource,
  retweeters: retweetersSource,
};

async function markJobStatus(
  scrapeJobId: string,
  status: "running" | "completed" | "failed" | "paused",
  errorMessage?: string,
  extra?: Partial<{ startedAt: Date; finishedAt: Date; leadsFound: number }>
) {
  await studioUpdate<ScrapeJob>("scrape_jobs", scrapeJobId, { status, errorMessage: errorMessage ?? null, ...extra });
}

async function setAccountStatus(xAccountId: string, status: "active" | "checkpointed" | "banned") {
  await studioUpdate<XAccount>("x_accounts", xAccountId, { status });
}

async function touchAccountLastUsed(xAccountId: string) {
  await studioUpdate<XAccount>("x_accounts", xAccountId, { lastUsedAt: new Date() });
}

async function runScrape(data: ScrapeJobData): Promise<{ leadsFound: number }> {
  const account = await studioGet<XAccount>("x_accounts", data.xAccountId);
  if (!account) throw new Error(`X account ${data.xAccountId} not found`);
  if (!account.encryptedSession) {
    throw new Error(`X account ${data.xAccountId} has no saved session — run the login script first`);
  }

  const storageState = decryptSession(account.encryptedSession) as Parameters<
    typeof launchScrapeSession
  >[0];
  const proxy = account.encryptedProxy ? decryptProxy(account.encryptedProxy) : null;

  const session = await launchScrapeSession(storageState, proxy);
  try {
    const page = await session.context.newPage();
    const collectOpts = {
      page,
      sourceRef: data.sourceRef,
      capLeads: data.capLeads,
      minScrollDelayMs: env.SCROLL_DELAY_MIN_MS,
      maxScrollDelayMs: env.SCROLL_DELAY_MAX_MS,
    };

    let rawLeads: RawLead[];
    if (data.sourceType === "engagers") {
      // Each engagement type is its own page/strategy (reply thread vs. the retweets list) —
      // run them one after another on the same page and merge, deduping by handle so someone
      // who both replied and retweeted only counts once.
      const merged = new Map<string, RawLead>();
      for (const type of data.engagementTypes ?? []) {
        const items = await scrollAndCollect(ENGAGEMENT_SOURCES[type], collectOpts);
        for (const item of items) {
          const key = item.handle.toLowerCase();
          if (!merged.has(key)) merged.set(key, item);
        }
      }
      rawLeads = Array.from(merged.values()).slice(0, data.capLeads);
    } else {
      rawLeads = await scrollAndCollect(SOURCES[data.sourceType], collectOpts);
    }

    const enrichedLeads = await enrichLeadsFromProfiles(page, rawLeads, {
      minDelayMs: env.PROFILE_DELAY_MIN_MS,
      maxDelayMs: env.PROFILE_DELAY_MAX_MS,
    });
    const leadsFound = await upsertLeads(data.userId, data.sourceType, data.sourceRef, enrichedLeads);
    return { leadsFound };
  } finally {
    await closeScrapeSession(session);
  }
}

export function startScrapeWorker(): Worker<ScrapeJobData> {
  const worker = new Worker<ScrapeJobData>(
    SCRAPE_QUEUE_NAME,
    async (job, token) => {
      const { scrapeJobId, xAccountId } = job.data;

      const account = await studioGet<XAccount>("x_accounts", xAccountId);
      if (!account) {
        await markJobStatus(scrapeJobId, "failed", "X account no longer exists");
        return;
      }
      if (account.status !== "active") {
        await markJobStatus(scrapeJobId, "failed", `Account is ${account.status}`);
        return;
      }

      const slot = await acquireAccountSlot(xAccountId, account.maxConcurrency);
      if (!slot) {
        const jitterMs = 3000 + Math.floor(Math.random() * 5000);
        await job.moveToDelayed(Date.now() + jitterMs, token);
        throw new DelayedError();
      }

      try {
        const withinQuota = await tryConsumeDailyQuota(xAccountId, account.dailyScrapeLimit);
        if (!withinQuota) {
          await markJobStatus(scrapeJobId, "paused", "Daily scrape limit reached for this account");
          return;
        }

        await markJobStatus(scrapeJobId, "running", undefined, { startedAt: new Date() });
        const { leadsFound } = await runScrape(job.data);
        await markJobStatus(scrapeJobId, "completed", undefined, { finishedAt: new Date(), leadsFound });
        await touchAccountLastUsed(xAccountId);
        await logActivity(job.data.userId, "scrape.completed", {
          scrapeJobId,
          xAccountId,
          sourceType: job.data.sourceType,
          leadsFound,
        });
      } catch (err) {
        if (isAccountHealthError(err)) {
          await setAccountStatus(xAccountId, "checkpointed");
          await markJobStatus(scrapeJobId, "paused", `Account checkpointed: ${err.message}`);
          await logActivity(job.data.userId, "account.checkpointed", {
            xAccountId,
            reason: err.message,
          });
          return; // terminal — do not let BullMQ retry a checkpointed account
        }

        const message = err instanceof Error ? err.message : String(err);
        await markJobStatus(scrapeJobId, "failed", message, { finishedAt: new Date() });
        throw err; // real error: let BullMQ's attempts/backoff apply
      } finally {
        await releaseAccountSlot(slot);
      }
    },
    { connection: redisConnection, concurrency: env.WORKER_CONCURRENCY }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "scrape job failed");
  });

  return worker;
}
