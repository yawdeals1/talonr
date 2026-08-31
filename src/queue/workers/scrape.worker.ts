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
  describeScrapeOutcome,
  isCancelledJob,
  withRunDeadline,
} from "../../modules/scrapes/scrape-cancel.js";
import {
  clearScrapeFinishRequest,
  clearScrapePauseRequest,
  saveScrapeJobLeadIds,
  saveScrapeProgress,
  saveScrapeResumeAt,
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
  type CollectionStopReason,
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
 * filled in on the next successful run. These partials are still persisted and recorded as exact
 * members of the scrape; the saved result filter decides whether they are visible at read time.
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
  // `false` and `""` are how the form says "not set" for the non-numeric bounds, and a filter of
  // nothing must not put the run on the filtered path — that one collects five times the candidates,
  // which is a lot of extra requests to X to enforce no bound at all.
  return !!filter && Object.values(filter).some((value) => value !== undefined && value !== false && value !== "");
}

// Ceiling on the candidate pool regardless of cap × multiplier, matching the per-job cap the API
// accepts (scrapes.controller.ts#createSchema).
const MAX_CANDIDATE_LEADS = 1000;

/**
 * The share of a run's wall-clock budget that reading the list may spend before it has to hand
 * over to the profile pass.
 *
 * Reading the list produces nothing on its own — a lead is only saved once its profile has been
 * read (or the run is cut short and its raw partials are rescued) — so collection must never be
 * able to spend the whole budget. On a target with no natural end (a large followers
 * list, a reply thread thousands deep) it otherwise would: the scroll loop only stops at the
 * candidate cap or four stagnant rounds, and neither arrives. Half leaves the profile pass, which
 * is the slower half per lead, a real share of the clock. Collection that ends sooner hands its
 * unused time straight to enrichment, which runs against the whole-run deadline.
 */
const COLLECT_BUDGET_SHARE = 0.5;

/**
 * A wait, in words a person can act on.
 *
 * The alternative it replaced was an ISO timestamp printed into the job's error message, which is
 * both unreadable at a glance and wrong within a minute of being written. The exact moment is
 * carried as data (`resumeAt`) for the job page to count down to; this is the sentence's share.
 */
function describeMinutes(until: Date): string {
  const minutes = Math.max(1, Math.round((until.getTime() - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * The single verdict for an "engagers" run, which reads two lists through the collector.
 *
 * Worst-first: an ending that owes the user an explanation must not be hidden by the other
 * strategy having finished tidily.
 */
function mergeCollectionReasons(reasons: CollectionStopReason[]): CollectionStopReason {
  const order: CollectionStopReason[] = ["stopped", "stalled", "exhausted", "cap"];
  for (const candidate of order) {
    if (reasons.includes(candidate)) return candidate;
  }
  return "cap";
}

/** How often a running job republishes its counters. */
const PROGRESS_REPORT_INTERVAL_MS = 3_000;

/**
 * Collects the run's output as it happens: writes every candidate immediately, records exact
 * membership, and publishes counters the job page can read while the scrape is still going.
 *
 * Two deliberate behaviours live here. Leads are saved one at a time rather than in a single batch
 * at the end, so the job page fills in during the run instead of staying empty until it finishes.
 * The database stays deliberately unfiltered: one scrape can support unlimited later filter
 * changes, and a continued run must remember rejected candidates too or it will revisit the same
 * first page forever. `saved` is therefore a display/target counter (matching persisted leads), not
 * a gate in front of persistence. The scrape results endpoint applies the stored filter at read time.
 */
function createLeadSink(data: ScrapeJobData) {
  const filter = hasResultFilter(data.resultFilter) ? data.resultFilter : null;
  const matches = filter ? buildFilterPredicate(filter) : null;
  let collected = 0;
  let checked = 0;
  let saved = 0;
  let failed = 0;
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
    get checked() {
      return checked;
    },
    get collected() {
      return collected;
    },
    get failed() {
      return failed;
    },
    noteCollected(count: number): void {
      collected = count;
      void report();
    },
    /**
     * Moves the run into its profile pass.
     *
     * `collected` is deliberately left alone. It used to be overwritten with the number of
     * candidates about to be checked, which quietly erased the one number that says how much of the
     * list was actually read. The profile pass must not overwrite that with a candidate subset or
     * the panel would show the post-processing figure as though the list had only yielded that much.
     */
    startChecking(): void {
      phase = "checking";
      void report(true);
    },
    /**
     * Saves one freshly-read lead, then republishes the counters. A filter controls only whether
     * this lead advances the matching target; it never controls persistence or exact membership.
     *
     * A single Studio DB hiccup on this one lead's GET-then-insert/update call used to propagate
     * straight out of here into `enrichLeadsFromProfiles`'s "could not save lead mid-run; continuing"
     * catch, which only logs a warning and moves on — the lead was gone for good, `saved` never
     * incremented, and the finished job showed a plain, unexplained "9 of 10" with no error anywhere
     * a user could see. One retry clears a transient blip; if it still fails, the miss is at least
     * counted so the job can say why it came up short instead of silently reporting a lower number.
     */
    async accept(lead: RawLead, matched: boolean): Promise<void> {
      checked += 1;
      try {
        const persisted = await persistLeads(data, [lead]);
        if (matched) saved += persisted;
      } catch {
        try {
          const persisted = await persistLeads(data, [lead]);
          if (matched) saved += persisted;
        } catch (err) {
          if (matched) failed += 1;
          logger.warn(
            { err, scrapeJobId: data.scrapeJobId, handle: lead.handle, matched },
            "could not save lead after retrying; it is missing from this run's exact results"
          );
        }
      }
      await report();
    },
    /** Saves every candidate left over from a run that was cut short, still counting only matches. */
    async acceptRemainder(leads: RawLead[]): Promise<number> {
      if (leads.length === 0) return 0;
      const count = await persistLeads(data, leads);
      const matchingCount = matches ? leads.filter(matches).length : count;
      saved += matchingCount;
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
interface RunOutcome {
  leadsFound: number;
  timedOut: boolean;
  unenriched: number;
  /** The user asked for this run to stop but stay resumable. */
  paused: boolean;
  /** Unique accounts read off the list view, before any filtering. */
  collected: number;
  /** Accounts an earlier run already had, which this one scrolled past without re-collecting. */
  skipped: number;
  /** Why reading the list ended. */
  collectionReason: CollectionStopReason;
  /** Scroll rounds the list took. Logged, not shown: it is what separates "one round and done" —
   * the scroll never landing — from "forty rounds that each returned the same cells". */
  rounds: number;
}

async function runScrape(data: ScrapeJobData, sink: LeadSink): Promise<RunOutcome> {
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

    // A pause is answered exactly like "Finish now" everywhere downstream — stop looking, keep
    // everything found — and differs only in how the job ends: paused and resumable rather than
    // done. Translating it here rather than teaching the scraper modules a third verdict keeps them
    // free of any notion of what a job's statuses are.
    let pauseRequested = false;
    const rawCheckpoint = createRunCheckpoint(data.userId, data.scrapeJobId);
    const checkpoint = async (): Promise<"continue" | "finish"> => {
      const verdict = await rawCheckpoint();
      if (verdict === "pause") {
        pauseRequested = true;
        return "finish";
      }
      return verdict;
    };

    const skipHandles = new Set((data.skipHandles ?? []).map((handle) => handle.toLowerCase()));
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
      skipHandles,
    };

    let rawLeads: RawLead[];
    let collectionReason: CollectionStopReason;
    let skipped: number;
    let rounds: number;
    try {
      if (data.sourceType === "engagers") {
        // Each engagement type is its own page/strategy (reply thread vs. the retweets list) —
        // run them one after another on the same page and merge, deduping by handle so someone
        // who both replied and retweeted only counts once. The shared map also means a failure
        // during the second strategy still carries the first one's leads out as partials.
        const merged = new Map<string, RawLead>();
        const results = [];
        for (const type of data.engagementTypes ?? []) {
          results.push(await scrollAndCollect(ENGAGEMENT_SOURCES[type], { ...collectOpts, into: merged }));
        }
        rawLeads = Array.from(merged.values()).slice(0, candidateCap);
        // Two strategies, one verdict: report the least satisfying ending, since that is the one
        // that explains why the merged run came up short.
        collectionReason = mergeCollectionReasons(results.map((result) => result.reason));
        skipped = results.reduce((total, result) => total + result.skipped, 0);
        rounds = results.reduce((total, result) => total + result.rounds, 0);
      } else {
        const result = await scrollAndCollect(SOURCES[data.sourceType], collectOpts);
        rawLeads = result.leads;
        collectionReason = result.reason;
        skipped = result.skipped;
        rounds = result.rounds;
      }
    } catch (err) {
      await savePartialLeads(data, sink, err);
      throw err;
    }

    // Never trust the list cell as the final verification verdict. X changes this markup
    // independently of the profile header and may omit the badge while virtualizing a long list.
    // Pre-filtering here turned a healthy verified-only scrape into "60 found, 0 checked, 0 saved".
    // Visit every candidate, merge the profile header, persist it unfiltered, and let the result
    // predicate decide whether it advances the matching target.
    const candidates = rawLeads;

    sink.startChecking();

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
      enriched = await enrichLeadsFromProfiles(page, candidates, {
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
    // it *found what it was asked for*, the leads it never reached have not been checked and are not
    // exact members of this run. They are saved only when the user or clock stopped enrichment
    // early, preserving work the collector had already completed.
    let unenriched = 0;
    const unvisited = enrichStoppedEarly ? candidates.slice(enriched.length) : [];
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

    return {
      leadsFound: sink.saved,
      timedOut,
      unenriched,
      paused: pauseRequested,
      collected: rawLeads.length,
      skipped,
      collectionReason,
      rounds,
    };
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
        await Promise.all([
          noteJobWaiting(
            scrapeJobId,
            `Waiting out X's rate limit on this account — about ${describeMinutes(cooldown.until)} left. This job starts on its own; nothing to do.`
          ),
          saveScrapeResumeAt(job.data.userId, scrapeJobId, cooldown.until),
        ]).catch((err: unknown) => logger.warn({ err, scrapeJobId }, "could not record the cooldown wait"));
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
        const outcome = await runScrape(job.data, sink);
        const { leadsFound, timedOut, unenriched, paused } = outcome;
        // Why this run produced the number it did — every bound it could have hit names itself.
        // Before this, the clock was the only one that ever explained itself, so a run whose list
        // stopped serving new accounts after five finished green and silent, indistinguishable
        // from a target that genuinely only had five.
        const shortfall = describeScrapeOutcome({
          capLeads: job.data.capLeads,
          leadsFound,
          collected: outcome.collected,
          checked: sink.checked,
          skipped: outcome.skipped,
          collectionReason: outcome.collectionReason,
          filtered: hasResultFilter(job.data.resultFilter),
          timedOut,
          budgetMinutes: env.SCRAPE_MAX_RUN_MINUTES,
          unenriched,
        });
        // A lead that matched but couldn't be saved after a retry is a second, independent reason
        // the count can come up short of what was asked for — distinct from running out of clock,
        // and just as invisible to the user if it isn't said out loud here.
        const failedNote =
          sink.failed > 0
            ? `${sink.failed} matching lead${sink.failed === 1 ? "" : "s"} could not be saved after a retry — a database error, not a shortage of matches. Run it again to pick ${sink.failed === 1 ? "it" : "them"} up.`
            : null;

        if (paused) {
          // Stopped on the user's word rather than on a limit, and deliberately resumable: the job
          // keeps its leads and goes back on the queue untouched when they press Resume.
          const pausedNote = ["Paused by you. Resume to carry on from here.", shortfall, failedNote]
            .filter(Boolean)
            .join(" ");
          await markJobStatus(scrapeJobId, "paused", pausedNote, { finishedAt: new Date(), leadsFound });
          await touchAccountLastUsed(xAccountId);
          await logActivity(job.data.userId, "scrape.paused", {
            scrapeJobId,
            xAccountId,
            sourceType: job.data.sourceType,
            leadsFound,
          });
          return;
        }

        const shortfallNote = [shortfall, failedNote].filter(Boolean).join(" ") || undefined;
        await markJobStatus(scrapeJobId, "completed", shortfallNote, { finishedAt: new Date(), leadsFound });
        await touchAccountLastUsed(xAccountId);
        await logActivity(job.data.userId, "scrape.completed", {
          scrapeJobId,
          xAccountId,
          sourceType: job.data.sourceType,
          leadsFound,
          timedOut,
          unenriched,
          collectionReason: outcome.collectionReason,
          collected: outcome.collected,
          rounds: outcome.rounds,
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
          // The resume time goes on the job as data, not baked into the sentence: an ISO timestamp
          // in an error message is unreadable and, minutes later, wrong. The job page counts down
          // to `resumeAt` instead and offers Resume the moment it passes.
          await saveScrapeResumeAt(job.data.userId, scrapeJobId, rest.until).catch((saveErr: unknown) =>
            logger.warn({ err: saveErr, scrapeJobId }, "could not record when this job may resume")
          );
          await markJobStatus(
            scrapeJobId,
            "paused",
            `X rate-limited this run, so it stopped early and kept what it had. The account stays connected — no reconnect needed — and rests for about ${describeMinutes(rest.until)} before this scrape can be resumed. (${err.message})`,
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
        await Promise.all([
          clearScrapeFinishRequest(job.data.userId, scrapeJobId),
          clearScrapePauseRequest(job.data.userId, scrapeJobId),
        ]).catch((err: unknown) => logger.warn({ err, scrapeJobId }, "could not clear the stop requests"));
      }
    },
    { connection: redisConnection, concurrency: env.WORKER_CONCURRENCY }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "scrape job failed");
  });

  return worker;
}
