import { DelayedError, Worker } from "bullmq";
import { env } from "../../config/env.js";
import { studioGet, studioUpdate } from "../../db/studio-client.js";
import type { EngagementType, ScrapeJob, ScrapeResultFilter, XAccount } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";
import { logActivity } from "../../modules/activity/activity.service.js";
import { buildFilterPredicate } from "../../modules/lead-lists/filter-query-builder.js";
import { upsertLeads } from "../../modules/leads/leads.service.js";
import { CANCELLED_ERROR_MESSAGE, createCancellationCheck, isCancelledJob } from "../../modules/scrapes/scrape-cancel.js";
import { saveScrapeJobLeadIds } from "../../modules/scrapes/scrape-results.service.js";
import { closeScrapeSession, launchScrapeSession } from "../../scraper/browser.js";
import { enrichLeadsFromProfiles } from "../../scraper/profile-enricher.js";
import { decryptProxy, decryptSession } from "../../scraper/session-store.js";
import { scrollAndCollect } from "../../scraper/scroll-collector.js";
import { followersSource } from "../../scraper/sources/followers.source.js";
import { repliersSource } from "../../scraper/sources/repliers.source.js";
import { retweetersSource } from "../../scraper/sources/retweeters.source.js";
import { searchSource } from "../../scraper/sources/search.source.js";
import {
  attachPartialLeads,
  getPartialLeads,
  getPartialLeadsSaved,
  isAccountHealthError,
  isScrapeCancelledError,
  setPartialLeadsSaved,
  type RawLead,
  type ScrapeSource,
} from "../../scraper/types.js";
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

async function persistLeads(data: ScrapeJobData, leads: RawLead[]): Promise<number> {
  const savedLeads = await upsertLeads(data.userId, data.sourceType, data.sourceRef, leads);
  // The leads are already persisted at this point. Recording exact per-job membership is a
  // nice-to-have on top of that, so a failure here must not throw: doing so marked a successful
  // scrape "failed" and let BullMQ re-run the entire Playwright scrape up to `attempts` times,
  // burning the account's daily quota and hitting X again for leads already collected.
  try {
    await saveScrapeJobLeadIds(data.userId, data.scrapeJobId, savedLeads.map((lead) => lead.id));
  } catch (err) {
    logger.warn(
      { err, scrapeJobId: data.scrapeJobId },
      "could not record exact lead membership; leads were saved and the job still counts as completed"
    );
  }
  return savedLeads.length;
}

/**
 * Saves whatever a cut-short run managed to collect, recording the count on the error so the
 * caller can report it on the paused job.
 *
 * Enrichment is deliberately skipped: the run was stopped because X pushed back, and visiting one
 * profile per lead is the last thing to do in that state. `upsertLeads` merges rather than
 * overwrites, so the missing profile fields stay whatever a previous scrape put on file and get
 * filled in on the next successful run.
 */
async function savePartialLeads(data: ScrapeJobData, err: unknown): Promise<void> {
  const partial = getPartialLeads(err);
  if (partial.length === 0) return;

  try {
    setPartialLeadsSaved(err, await persistLeads(data, partial));
  } catch (saveErr) {
    logger.warn(
      { err: saveErr, scrapeJobId: data.scrapeJobId },
      "could not save partial leads from a cut-short scrape"
    );
  }
}

/**
 * How many candidate profiles a filtered run may visit per lead it's asked for.
 *
 * A follower range only means something if the run keeps looking until it has that many matching
 * accounts — collecting the first `capLeads` accounts in the list and filtering afterwards left a
 * "100–2000 followers, 10 leads" scrape showing 2 rows, which is what "the filter doesn't work"
 * looked like from the outside. The multiplier is what stops that turning into an unbounded crawl:
 * with the default, a 10-lead filtered scrape visits at most 50 profiles and then reports whatever
 * it found. Configurable via SCRAPE_FILTER_CANDIDATE_MULTIPLIER.
 */
function candidateCapFor(data: ScrapeJobData): number {
  if (!hasResultFilter(data.resultFilter)) return data.capLeads;
  return Math.min(data.capLeads * env.SCRAPE_FILTER_CANDIDATE_MULTIPLIER, MAX_CANDIDATE_LEADS);
}

function hasResultFilter(filter: ScrapeResultFilter | undefined): filter is ScrapeResultFilter {
  return !!filter && Object.values(filter).some((value) => value !== undefined);
}

// Ceiling on the candidate pool regardless of cap × multiplier, matching the per-job cap the API
// accepts (scrapes.controller.ts#createSchema).
const MAX_CANDIDATE_LEADS = 1000;

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
    const candidateCap = candidateCapFor(data);
    const shouldCancel = createCancellationCheck(data.scrapeJobId);
    const collectOpts = {
      page,
      sourceRef: data.sourceRef,
      capLeads: candidateCap,
      minScrollDelayMs: env.SCROLL_DELAY_MIN_MS,
      maxScrollDelayMs: env.SCROLL_DELAY_MAX_MS,
      shouldCancel,
    };

    let rawLeads: RawLead[];
    try {
      if (data.sourceType === "engagers") {
        // Each engagement type is its own page/strategy (reply thread vs. the retweets list) —
        // run them one after another on the same page and merge, deduping by handle so someone
        // who both replied and retweeted only counts once. The shared map also means a failure
        // during the second strategy still carries the first one's leads out as partials.
        const merged = new Map<string, RawLead>();
        for (const type of data.engagementTypes ?? []) {
          await scrollAndCollect(ENGAGEMENT_SOURCES[type], { ...collectOpts, into: merged });
        }
        rawLeads = Array.from(merged.values()).slice(0, candidateCap);
      } else {
        rawLeads = await scrollAndCollect(SOURCES[data.sourceType], collectOpts);
      }
    } catch (err) {
      await savePartialLeads(data, err);
      throw err;
    }

    let enrichedLeads: RawLead[];
    try {
      enrichedLeads = await enrichLeadsFromProfiles(page, rawLeads, {
        minDelayMs: env.PROFILE_DELAY_MIN_MS,
        maxDelayMs: env.PROFILE_DELAY_MAX_MS,
        shouldCancel,
        // With a filter on the job, aim for capLeads *matching* leads out of the larger candidate
        // pool collected above; the enricher stops as soon as it has them.
        ...(hasResultFilter(data.resultFilter)
          ? { target: { matches: buildFilterPredicate(data.resultFilter), count: data.capLeads } }
          : {}),
      });
    } catch (err) {
      // Enrichment stopped early (throttled part-way through the profile visits). Anything it
      // already enriched rides out on the error; only if it got through none of them do the
      // list-view leads stand in — and then only up to what the job actually asked for, since the
      // candidate pool is deliberately oversized and its tail was never visited.
      if (getPartialLeads(err).length === 0) attachPartialLeads(err, rawLeads.slice(0, data.capLeads));
      await savePartialLeads(data, err);
      throw err;
    }

    return { leadsFound: await persistLeads(data, enrichedLeads) };
  } finally {
    await closeScrapeSession(session);
  }
}

export function startScrapeWorker(): Worker<ScrapeJobData> {
  const worker = new Worker<ScrapeJobData>(
    SCRAPE_QUEUE_NAME,
    async (job, token) => {
      const { scrapeJobId, xAccountId } = job.data;

      // Checked before anything else costs a quota slot or a browser: a cancel that landed while
      // the job was queued should never start, and neither should one that landed mid-run and then
      // came back here because a worker restart handed BullMQ a stalled job to retry.
      const jobRow = await studioGet<ScrapeJob>("scrape_jobs", scrapeJobId);
      if (!jobRow || isCancelledJob(jobRow)) {
        logger.info({ scrapeJobId }, "skipping scrape: the job was cancelled or no longer exists");
        return;
      }

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
        if (isScrapeCancelledError(err)) {
          // The row is already `failed`/"Cancelled by user" — the API wrote that when the user
          // asked, which is what this run just noticed. Only the outcome of the work needs
          // recording: whatever it had collected has been saved by now.
          const leadsFound = getPartialLeadsSaved(err);
          await markJobStatus(scrapeJobId, "failed", CANCELLED_ERROR_MESSAGE, {
            finishedAt: new Date(),
            leadsFound,
          });
          await logActivity(job.data.userId, "scrape.cancelled", {
            scrapeJobId,
            xAccountId,
            sourceType: job.data.sourceType,
            leadsFound,
          });
          return; // terminal — a cancelled scrape must never be retried
        }

        if (isAccountHealthError(err)) {
          const leadsFound = getPartialLeadsSaved(err);
          await setAccountStatus(xAccountId, "checkpointed");
          await markJobStatus(scrapeJobId, "paused", `Account checkpointed: ${err.message}`, {
            finishedAt: new Date(),
            leadsFound,
          });
          await logActivity(job.data.userId, "account.checkpointed", {
            xAccountId,
            reason: err.message,
            leadsFound,
          });
          return; // terminal — do not let BullMQ retry a checkpointed account
        }

        const message = err instanceof Error ? err.message : String(err);
        await markJobStatus(scrapeJobId, "failed", message, {
          finishedAt: new Date(),
          // A run that died part-way may still have saved what it collected — report that rather
          // than a bare 0 next to the error.
          leadsFound: getPartialLeadsSaved(err),
        });
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
