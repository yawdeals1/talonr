import { studioGet } from "../../db/studio-client.js";
import type { ScrapeJob } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";
import type { CollectionStopReason } from "../../scraper/types.js";
import { ScrapeCancelledError } from "../../scraper/types.js";
import { isScrapeFinishRequested, isScrapePauseRequested } from "./scrape-results.service.js";

/**
 * How a cancelled run is recorded.
 *
 * `scrape_jobs.status` is a Postgres enum (`scrape_job_status`) owned by a role this app's Studio
 * DB connection isn't a member of — `ALTER TYPE ... ADD VALUE` fails with "must be owner of type
 * scrape_job_status" — so there is no `cancelled` value to write and no way to add one from here.
 * A cancelled job is therefore stored as the existing terminal `failed` status carrying exactly
 * this message, which is what the pre-existing cancel path for not-yet-started jobs already did.
 * `isCancelledJob` is the single place that knows the encoding; the API and the UI both read a
 * cancelled job through it rather than string-matching on their own.
 */
export const CANCELLED_ERROR_MESSAGE = "Cancelled by user";

/** How long a run may go between checks for a stop request. */
const CONTROL_POLL_INTERVAL_MS = 8_000;

/**
 * What a running scrape should do at its next checkpoint.
 *
 * "finish" is the deliberate, non-destructive stop the user asks for with "Finish now": stop
 * looking for more, keep everything found so far, and let the job complete normally. "pause" stops
 * the same way and keeps the same leads, but leaves the job resumable rather than done. A cancel is
 * the other thing entirely and comes through as a thrown `ScrapeCancelledError`.
 */
export type RunVerdict = "continue" | "finish" | "pause";

export function isCancelledJob(job: Pick<ScrapeJob, "status" | "errorMessage">): boolean {
  return job.status === "failed" && job.errorMessage === CANCELLED_ERROR_MESSAGE;
}

/**
 * Builds the "should this run keep going?" probe the worker calls at its checkpoints — each scroll
 * round, and before each profile visit. It answers one of two ways:
 *
 * - throws `ScrapeCancelledError` when the run was cancelled, which unwinds through the same
 *   partial-lead path a throttled run uses, so a cancelled scrape keeps the leads it already had;
 * - returns `"finish"` when the user asked it to wrap up, so the caller stops looking for more and
 *   lets the job complete normally with what it found;
 * - returns `"pause"` for the same stop with a different ending: the job is left `paused` and
 *   resumable, so the run can be picked up again where it stopped instead of being over.
 *
 * Both signals are database rows rather than in-memory flags or Redis keys, for two reasons: the
 * API and the worker are separate processes, and a stop has to survive a worker restart — BullMQ
 * hands a stalled job to the next worker, which would otherwise re-run a scrape the user had
 * already stopped. Reads are throttled to one round trip per CONTROL_POLL_INTERVAL_MS, so a long
 * run costs a handful of extra Studio calls rather than two per scroll round.
 */
export function createRunCheckpoint(userId: string, scrapeJobId: string): () => Promise<RunVerdict> {
  let lastCheckedAt = 0;
  let cancelled = false;
  let verdict: RunVerdict = "continue";

  return async () => {
    if (cancelled) throw new ScrapeCancelledError();
    if (verdict !== "continue") return verdict;
    if (Date.now() - lastCheckedAt < CONTROL_POLL_INTERVAL_MS) return "continue";
    lastCheckedAt = Date.now();

    let job: ScrapeJob | null;
    let finishRequested: boolean;
    let pauseRequested: boolean;
    try {
      [job, finishRequested, pauseRequested] = await Promise.all([
        studioGet<ScrapeJob>("scrape_jobs", scrapeJobId),
        isScrapeFinishRequested(userId, scrapeJobId),
        isScrapePauseRequested(userId, scrapeJobId),
      ]);
    } catch (err) {
      // A failed poll must not kill a healthy run — the next checkpoint tries again.
      logger.warn({ err, scrapeJobId }, "could not check whether the scrape was asked to stop");
      return "continue";
    }

    // A job row deleted mid-run is as good as cancelled: there is nowhere left to report to.
    if (!job || isCancelledJob(job)) {
      cancelled = true;
      throw new ScrapeCancelledError();
    }

    // Pause is checked first: it is the more conservative of the two endings — same leads kept,
    // but the run stays resumable — so if both rows somehow exist, the recoverable one wins.
    if (pauseRequested) {
      logger.info({ scrapeJobId }, "pausing at the user's request");
      verdict = "pause";
    } else if (finishRequested) {
      logger.info({ scrapeJobId }, "finishing early at the user's request");
      verdict = "finish";
    }
    return verdict;
  };
}

/**
 * Wraps a run checkpoint with a wall-clock deadline, so a run stops on the clock as well as on the
 * user's word.
 *
 * A scrape's only other bound is the lead cap, and on a target big enough that bound never
 * arrives: X keeps serving more followers/replies, so a run that has to check several candidates
 * per lead it keeps will scroll and visit profiles indefinitely. The deadline is answered as
 * `"finish"` — the same verdict "Finish now" produces — because running out of time is not a
 * failure: the run stops looking, keeps everything it found, and the job completes normally.
 *
 * The wrapped checkpoint is asked first so a cancel still wins: a user who stopped the run should
 * see it recorded as cancelled, not as a run that happened to time out at the same moment.
 * `onExpire` fires once, the first time the clock is what stopped the run, so the caller can say
 * so on the finished job.
 */
export function withRunDeadline<V extends RunVerdict>(
  // Generic over the wrapped checkpoint's verdicts so a caller that has already narrowed them —
  // the worker translates "pause" into "finish" before the deadline ever sees it — gets its
  // narrowed type back rather than the full union widened onto it again.
  checkpoint: () => Promise<V>,
  deadlineAt: number,
  onExpire?: () => void
): () => Promise<V | "continue" | "finish"> {
  let expired = false;

  return async () => {
    const verdict = await checkpoint();
    if (verdict !== "continue") return verdict;
    if (Date.now() < deadlineAt) return "continue";

    if (!expired) {
      expired = true;
      onExpire?.();
    }
    return "finish";
  };
}

/** Everything a finished run knows about why it produced the number of leads it did. */
export interface ScrapeOutcomeSummary {
  /** Leads the user asked for. */
  capLeads: number;
  /** Leads actually saved. */
  leadsFound: number;
  /** Unique accounts read off the list view. */
  collected: number;
  /** Profiles actually visited. */
  checked: number;
  /** Collected accounts dropped before the profile pass because the run was verified-only. */
  droppedUnverified: number;
  /** Accounts an earlier run already had, which a resumed/continued run scrolled past. */
  skipped: number;
  /** Why reading the list ended. */
  collectionReason: CollectionStopReason;
  /** Whether the run carries a follower/location filter, which makes "checked" and "saved" differ. */
  filtered: boolean;
  /** Whether the run hit its wall-clock budget, and what that budget was. */
  timedOut: boolean;
  budgetMinutes: number;
  /** Leads saved straight off the list, whose profiles the run never reached. */
  unenriched: number;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Why a finished run produced the number of leads it did, or `null` when it did what was asked.
 *
 * This exists because "completed" with a green tick and no message was the *only* thing a
 * short run said. The clock was the single bound that ever explained itself, so a followers scrape
 * asked for 100 that read five accounts off the list and stopped finished looking exactly like a
 * target that genuinely only had five — no note, no error, nothing to act on, and no way to tell
 * a scrolling bug from a small account. Every bound a run can hit now names itself:
 *
 * - the list stopped producing, either because it ended or because X stopped serving it;
 * - verified-only dropped candidates before the profile pass;
 * - the filter matched fewer of the profiles read than were asked for;
 * - the clock beat the cap, or beat the profile pass.
 *
 * Deliberately not gated on `leadsFound < capLeads`: a run can hit its full count and still owe the
 * user an explanation, because leads saved off the list with no profile behind them have no
 * follower count and are invisible to every range filter.
 */
export function describeScrapeOutcome(summary: ScrapeOutcomeSummary): string | null {
  const {
    capLeads,
    leadsFound,
    collected,
    checked,
    droppedUnverified,
    skipped,
    collectionReason,
    filtered,
    timedOut,
    budgetMinutes,
    unenriched,
  } = summary;

  const short = leadsFound < capLeads;
  if (!short && unenriched === 0) return null;

  const parts: string[] = [];

  if (timedOut) {
    parts.push(`Stopped at the ${budgetMinutes}-minute run limit with ${plural(leadsFound, "lead")} of the ${capLeads.toLocaleString()} requested.`);
  } else if (short && collectionReason === "exhausted") {
    parts.push(
      `Reached the end of the list after ${plural(collected, "account")} — X had no more to show, ` +
        `so ${plural(leadsFound, "lead")} is everything this target can give.`
    );
  } else if (short && collectionReason === "stalled") {
    parts.push(
      `X stopped serving more of the list after ${plural(collected, "account")}: the page kept ` +
        "scrolling but returned no new accounts. Run it again later to pick up where this left off."
    );
  } else if (short) {
    parts.push(`Saved ${plural(leadsFound, "lead")} of the ${capLeads.toLocaleString()} requested.`);
  }

  if (skipped > 0) {
    parts.push(`${plural(skipped, "account")} already collected by an earlier run ${skipped === 1 ? "was" : "were"} scrolled past.`);
  }

  if (droppedUnverified > 0) {
    parts.push(
      `${plural(droppedUnverified, "collected account")} ${droppedUnverified === 1 ? "was" : "were"} not verified and ` +
        "so dropped before the profile pass."
    );
  }

  if (short && filtered && checked > leadsFound) {
    parts.push(`${plural(checked, "profile")} checked, ${leadsFound.toLocaleString()} matched your filter.`);
  }

  if (unenriched > 0) {
    parts.push(
      `${plural(unenriched, "lead")} ${unenriched === 1 ? "was" : "were"} saved straight off the list with no ` +
        "profile details — those have no follower count or location, so follower and location filters skip " +
        "them until another scrape fills them in."
    );
  }

  return parts.length > 0 ? parts.join(" ") : null;
}
