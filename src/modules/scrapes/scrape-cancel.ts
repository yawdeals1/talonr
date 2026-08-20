import { studioGet } from "../../db/studio-client.js";
import type { ScrapeJob } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";
import { ScrapeCancelledError } from "../../scraper/types.js";
import { isScrapeFinishRequested } from "./scrape-results.service.js";

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
 * looking for more, keep everything found so far, and let the job complete normally. A cancel is
 * the other thing entirely and comes through as a thrown `ScrapeCancelledError`.
 */
export type RunVerdict = "continue" | "finish";

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
 *   lets the job complete normally with what it found.
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
    if (verdict === "finish") return "finish";
    if (Date.now() - lastCheckedAt < CONTROL_POLL_INTERVAL_MS) return "continue";
    lastCheckedAt = Date.now();

    let job: ScrapeJob | null;
    let finishRequested: boolean;
    try {
      [job, finishRequested] = await Promise.all([
        studioGet<ScrapeJob>("scrape_jobs", scrapeJobId),
        isScrapeFinishRequested(userId, scrapeJobId),
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

    if (finishRequested) {
      logger.info({ scrapeJobId }, "finishing early at the user's request");
      verdict = "finish";
    }
    return verdict;
  };
}
