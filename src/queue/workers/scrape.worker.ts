import { DelayedError, Worker } from "bullmq";
import { env } from "../../config/env.js";
import { studioGet, studioUpdate } from "../../db/studio-client.js";
import type { EngagementType, ScrapeJob, ScrapeResultFilter, XAccount } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";
import { logActivity } from "../../modules/activity/activity.service.js";
import { buildFilterPredicate } from "../../modules/lead-lists/filter-query-builder.js";
import { upsertLeads } from "../../modules/leads/leads.service.js";
import {
  CANCELLED_ERROR_MESSAGE,
  createRunCheckpoint,
  describeRunLimitStop,
  isCancelledJob,
  withRunDeadline,
} from "../../modules/scrapes/scrape-cancel.js";
import {
  clearScrapeFinishRequest,
  saveScrapeJobLeadIds,
  saveScrapeProgress,
} from "../../modules/scrapes/scrape-results.service.js";
import { closeScrapeSession, launchScrapeSession } from "../../scraper/browser.js";
import { enrichLeadsFromProfiles } from "../../scraper/profile-enricher.js";
import { decryptProxy, decryptSession } from "../../scraper/session-store.js";
import { scrollAndCollect } from "../../scraper/scroll-collector.js";
import { followersSource } from "../../scraper/sources/followers.source.js";
import { repliersSource } from "../../scraper/sources/repliers.source.js";
import { retweetersSource } from "../../scraper/sources/retweeters.source.js";
import { searchSource } from "../../scraper/sources/search.source.js";
import {
  getPartialLeads,
  getPartialLeadsSaved,
  isAccountHealthError,
  isScrapeCancelledError,
  RateLimitedError,
  setPartialLeadsSaved,
  type RawLead,
  type ScrapeSource,
} from "../../scraper/types.js";
import { redisConnection } from "../connection.js";
import { SCRAPE_QUEUE_NAME, type ScrapeJobData } from "../queues.js";
import { getAccountCooldown, startAccountCooldown } from "../rate-limit/account-cooldown.js";
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

/**
 * Records why a job is sitting in the queue without moving it out of `queued` — a job waiting out
 * a rate-limit cooldown has not failed and will run on its own, so the status would be a lie, but
 * a queued job with no explanation looks stuck from the job page.
 */
async function noteJobWaiting(scrapeJobId: string, message: string) {
  await studioUpdate<ScrapeJob>("scrape_jobs", scrapeJobId, { errorMessage: message });
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
 * Saves whatever a run cut short during *collection* managed to gather, recording the count on the
 * error so the caller can report it on the stopped job.
 *
 * Enrichment is deliberately skipped: the run was stopped because X pushed back, and visiting one
 * profile per lead is the last thing to do in that state. `upsertLeads` merges rather than
 * overwrites, so the missing profile fields stay whatever a previous scrape put on file and get
 * filled in on the next successful run. On a filtered job these leads have no follower count yet,
 * so the sink keeps none of them — an unverified lead can't be claimed to match the range the user
 * asked for.
 */
async function savePartialLeads(data: ScrapeJobData, sink: LeadSink, err: unknown): Promise<void> {
  const partial = getPartialLeads(err);
  if (partial.length === 0) {
    setPartialLeadsSaved(err, sink.saved);
    return;
  }

  try {
    await sink.acceptRemainder(partial);
  } catch (saveErr) {
    logger.warn(
      { err: saveErr, scrapeJobId: data.scrapeJobId },
      "could not save partial leads from a cut-short scrape"
    );
  }
  setPartialLeadsSaved(err, sink.saved);
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

/**
 * The share of a run's wall-clock budget that reading the list may spend before it has to hand
 * over to the profile pass.
 *
 * Reading the list produces nothing on its own — a lead is only saved once its profile has been
 * read, and on a filtered run a lead with no follower count is dropped outright — so collection
 * must never be able to spend the whole budget. On a target with no natural end (a large followers
 * list, a reply thread thousands deep) it otherwise would: the scroll loop only stops at the
 * candidate cap or four stagnant rounds, and neither arrives. Half leaves the profile pass, which
 * is the slower half per lead, a real share of the clock. Collection that ends sooner hands its
 * unused time straight to enrichment, which runs against the whole-run deadline.
 */
const COLLECT_BUDGET_SHARE = 0.5;

/** How often a running job republishes its counters. */
const PROGRESS_REPORT_INTERVAL_MS = 3_000;

/**
 * Collects the run's output as it happens: decides what to keep, writes it immediately, and
 * publishes counters the job page can read while the scrape is still going.
 *
 * Two deliberate behaviours live here. Leads are saved one at a time rather than in a single batch
 * at the end, so the job page fills in during the run instead of staying empty until it finishes.
 * And when the job carries a follower/location filter, only leads that *match* it are written — a
 * filtered run checks several candidates per lead it wants, and saving the rejects put accounts far
 * outside the requested range into the user's leads list, which is exactly what the filter was
 * supposed to prevent. Runs without a filter still save every profile they read.
 */
function createLeadSink(data: ScrapeJobData) {
  const filter = hasResultFilter(data.resultFilter) ? data.resultFilter : null;
  const matches = filter ? buildFilterPredicate(filter) : null;
  let collected = 0;
  let checked = 0;
  let saved = 0;
  let phase: "collecting" | "checking" = "collecting";
  let lastReportAt = 0;

  async function report(force = false): Promise<void> {
    if (!force && Date.now() - lastReportAt < PROGRESS_REPORT_INTERVAL_MS) return;
    lastReportAt = Date.now();
    try {
      await saveScrapeProgress(data.userId, data.scrapeJobId, {
        phase,
        collected,
        checked,
        saved,
        target: filter ? data.capLeads : null,
      });
    } catch (err) {
      logger.warn({ err, scrapeJobId: data.scrapeJobId }, "could not publish scrape progress");
    }
  }

  return {
    get saved() {
      return saved;
    },
    keeps(lead: RawLead): boolean {
      return !matches || matches(lead);
    },
    noteCollected(count: number): void {
      collected = count;
      void report();
    },
    startChecking(count: number): void {
      phase = "checking";
      collected = count;
      void report(true);
    },
    /** Saves one freshly-read lead if it belongs in the results, then republishes the counters. */
    async accept(lead: RawLead, matched: boolean): Promise<void> {
      checked += 1;
      if (matched) {
        await persistLeads(data, [lead]);
        saved += 1;
      }
      await report();
    },
    /** Saves a batch left over from a run that was cut short, keeping the same filter rule. */
    async acceptRemainder(leads: RawLead[]): Promise<number> {
      const keep = matches ? leads.filter(matches) : leads;
      if (keep.length === 0) return 0;
      const count = await persistLeads(data, keep);
      saved += count;
      await report(true);
      return count;
    },
  };
}

type LeadSink = ReturnType<typeof createLeadSink>;

/**
 * Runs one scrape end to end and returns what it saved, plus what the run's clock cost it — a job
 * that stopped on time rather than on the leads it was asked for needs to say so, and so does one
 * whose profile pass didn't reach everything it had collected.
 */
async function runScrape(
  data: ScrapeJobData,
  sink: LeadSink
): Promise<{ leadsFound: number; timedOut: boolean; unenriched: number }> {
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

    // Two bounds on this run, whichever lands first: the leads the user asked for (capLeads, held
    // by the scroll cap and the enricher's match target), and this clock. Without the clock a run
    // against a target that never runs out only ends when it has collected its full candidate
    // pool — which on a busy reply thread is hours of scrolling, and is what left a 20-lead scrape
    // stuck on "Reading the list…" long past the point it was any use.
    const startedAt = Date.now();
    const runDeadlineAt = startedAt + env.SCRAPE_MAX_RUN_MINUTES * 60_000;
    const collectDeadlineAt = startedAt + env.SCRAPE_MAX_RUN_MINUTES * 60_000 * COLLECT_BUDGET_SHARE;
    let timedOut = false;
    const noteTimeout = (phase: "collecting" | "checking") => () => {
      timedOut = true;
      logger.info(
        { scrapeJobId: data.scrapeJobId, phase, budgetMinutes: env.SCRAPE_MAX_RUN_MINUTES },
        "scrape hit its run-time budget; wrapping up with what it has"
      );
    };

    const checkpoint = createRunCheckpoint(data.userId, data.scrapeJobId);
    const collectOpts = {
      page,
      sourceRef: data.sourceRef,
      capLeads: candidateCap,
      minScrollDelayMs: env.SCROLL_DELAY_MIN_MS,
      maxScrollDelayMs: env.SCROLL_DELAY_MAX_MS,
      rateLimitTolerance: env.RATE_LIMIT_TOLERANCE,
      rateLimitBackoffMs: env.RATE_LIMIT_BACKOFF_MS,
      navTimeoutMs: env.SCRAPE_NAV_TIMEOUT_MS,
      checkpoint: withRunDeadline(checkpoint, collectDeadlineAt, noteTimeout("collecting")),
      onProgress: (count: number) => sink.noteCollected(count),
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
      await savePartialLeads(data, sink, err);
      throw err;
    }

    sink.startChecking(rawLeads.length);

    // Whether the *profile pass* was told to stop before it ran out of candidates — by the user's
    // "Finish now" or by the run's own clock. Deliberately not `timedOut`, which the collection
    // phase can set on its own: what to do with the leads enrichment never reached depends only on
    // why enrichment ended, and hitting the match target is not a reason to keep them.
    let enrichStoppedEarly = false;
    const enrichDeadline = withRunDeadline(checkpoint, runDeadlineAt, noteTimeout("checking"));
    const enrichCheckpoint = async () => {
      const verdict = await enrichDeadline();
      if (verdict === "finish") enrichStoppedEarly = true;
      return verdict;
    };

    let enriched: RawLead[];
    try {
      enriched = await enrichLeadsFromProfiles(page, rawLeads, {
        minDelayMs: env.PROFILE_DELAY_MIN_MS,
        maxDelayMs: env.PROFILE_DELAY_MAX_MS,
        rateLimitTolerance: env.RATE_LIMIT_TOLERANCE,
        rateLimitBackoffMs: env.RATE_LIMIT_BACKOFF_MS,
        navTimeoutMs: env.SCRAPE_NAV_TIMEOUT_MS,
        checkpoint: enrichCheckpoint,
        onEnriched: (lead, matched) => sink.accept(lead, matched),
        // With a filter on the job, aim for capLeads *matching* leads out of the larger candidate
        // pool collected above; the enricher stops as soon as it has them.
        ...(hasResultFilter(data.resultFilter)
          ? { target: { matches: buildFilterPredicate(data.resultFilter), count: data.capLeads } }
          : {}),
      });
    } catch (err) {
      // Every lead read before this point is already saved (sink.accept writes as it goes), so
      // there is nothing left to rescue here — the count on the error is what the job reports.
      setPartialLeadsSaved(err, sink.saved);
      throw err;
    }

    // The enricher stops early for three reasons, and only two of them mean "keep the rest".
    // Stopped by the user or the clock, the leads it never reached were collected and would
    // otherwise be thrown away, so they go to the sink with their list-view data. Stopped because
    // it *found what it was asked for*, the leads it never reached are the candidates it
    // deliberately didn't need — saving those would put the whole unfiltered candidate pool into
    // the results of a run whose entire point was to narrow it, which is what the filter exists to
    // prevent. (`acceptRemainder`'s keep rule is not a sufficient guard on its own: a filter of
    // `{minFollowers: 0}` — what the form produces from a "0" in min followers — is a deliberate
    // no-op bound that every un-enriched lead passes.)
    let unenriched = 0;
    const unvisited = enrichStoppedEarly ? rawLeads.slice(enriched.length) : [];
    if (unvisited.length > 0) {
      try {
        unenriched = await sink.acceptRemainder(unvisited);
      } catch (err) {
        logger.warn(
          { err, scrapeJobId: data.scrapeJobId, unvisited: unvisited.length },
          "could not save the leads collected but not reached before the run stopped"
        );
      }
    }

    return { leadsFound: sink.saved, timedOut, unenriched };
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

      // X throttled this account recently. Wait the window out rather than failing the job: the
      // session is still valid, so this run will simply work later without anyone touching it.
      const cooldown = await getAccountCooldown(xAccountId);
      if (cooldown) {
        const resumeAt = cooldown.until.getTime() + Math.floor(Math.random() * 5000);
        await noteJobWaiting(
          scrapeJobId,
          `Waiting out X's rate limit on this account until ${cooldown.until.toISOString()} — this job will start on its own.`
        ).catch((err: unknown) => logger.warn({ err, scrapeJobId }, "could not record the cooldown wait"));
        logger.info({ scrapeJobId, xAccountId, resumeAt }, "account is cooling down; deferring the job");
        await job.moveToDelayed(resumeAt, token);
        throw new DelayedError();
      }

      const slot = await acquireAccountSlot(xAccountId, account.maxConcurrency);
      if (!slot) {
        const jitterMs = 3000 + Math.floor(Math.random() * 5000);
        await job.moveToDelayed(Date.now() + jitterMs, token);
        throw new DelayedError();
      }

      const sink = createLeadSink(job.data);

      try {
        const withinQuota = await tryConsumeDailyQuota(xAccountId, account.dailyScrapeLimit);
        if (!withinQuota) {
          await markJobStatus(scrapeJobId, "paused", "Daily scrape limit reached for this account");
          return;
        }

        await markJobStatus(scrapeJobId, "running", undefined, { startedAt: new Date() });
        const { leadsFound, timedOut, unenriched } = await runScrape(job.data, sink);
        // A run that ran out of clock still completed — it stopped looking and kept everything it
        // found — but it did not do what was asked, so the job carries a note saying so. Without
        // one, "20 requested, 6 found" is indistinguishable from a target that only had 6 matching
        // accounts in it, and a full-looking count of leads with no profile details behind it
        // looks like a clean success.
        const shortfallNote = timedOut
          ? (describeRunLimitStop({
              budgetMinutes: env.SCRAPE_MAX_RUN_MINUTES,
              leadsFound,
              capLeads: job.data.capLeads,
              unenriched,
            }) ?? undefined)
          : undefined;
        await markJobStatus(scrapeJobId, "completed", shortfallNote, { finishedAt: new Date(), leadsFound });
        await touchAccountLastUsed(xAccountId);
        await logActivity(job.data.userId, "scrape.completed", {
          scrapeJobId,
          xAccountId,
          sourceType: job.data.sourceType,
          leadsFound,
          timedOut,
          unenriched,
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

        // A rate limit is not a broken session — X is asking for less traffic, and the window
        // clears on its own. Checkpointing here meant `updateAccount` then refused to reactivate
        // the account, so every throttled run cost a full interactive re-login that re-proved
        // credentials nothing had questioned. Rest the account instead and leave it connected.
        if (err instanceof RateLimitedError) {
          const leadsFound = getPartialLeadsSaved(err);
          const rest = await startAccountCooldown(
            xAccountId,
            err.message,
            env.RATE_LIMIT_COOLDOWN_MINUTES,
            env.RATE_LIMIT_COOLDOWN_MAX_MINUTES
          );
          await markJobStatus(
            scrapeJobId,
            "paused",
            `X rate-limited this run. The account stays connected and rests until ${rest.until.toISOString()} — no reconnect needed. (${err.message})`,
            { finishedAt: new Date(), leadsFound }
          );
          await logActivity(job.data.userId, "account.rate_limited", {
            xAccountId,
            reason: err.message,
            restingUntil: rest.until.toISOString(),
            leadsFound,
          });
          return; // terminal for this job — the next one waits out the cooldown and runs itself
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
        // The run is over one way or another, so a pending "wrap up now" has nothing left to act
        // on. Clearing it keeps a retry of this job from stopping itself on a stale request.
        await clearScrapeFinishRequest(job.data.userId, scrapeJobId).catch((err: unknown) =>
          logger.warn({ err, scrapeJobId }, "could not clear the finish request")
        );
      }
    },
    { connection: redisConnection, concurrency: env.WORKER_CONCURRENCY }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "scrape job failed");
  });

  return worker;
}
