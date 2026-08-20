import { studioGet } from "../../db/studio-client.js";
import type { ScrapeJob } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";
import { ScrapeCancelledError } from "../../scraper/types.js";

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

/** How long a run may go between cancellation checks. */
const CANCEL_POLL_INTERVAL_MS = 8_000;

export function isCancelledJob(job: Pick<ScrapeJob, "status" | "errorMessage">): boolean {
  return job.status === "failed" && job.errorMessage === CANCELLED_ERROR_MESSAGE;
}

/**
 * Builds the "has the user asked this run to stop?" probe the worker calls at its checkpoints
 * (each scroll round, before each profile visit). Throws `ScrapeCancelledError` once the request
 * is in, which unwinds through the same partial-lead path a throttled run uses — so a cancelled
 * scrape keeps the leads it had already collected instead of throwing them away.
 *
 * The signal is the job row itself rather than an in-memory flag or a Redis key, for two reasons:
 * the API and the worker are separate processes, and a cancel has to survive a worker restart —
 * BullMQ hands a stalled job to the next worker, which would otherwise re-run a scrape the user
 * had already stopped. Reads are throttled to one per CANCEL_POLL_INTERVAL_MS so a long run costs
 * a handful of extra Studio calls, not one per scroll round.
 */
export function createCancellationCheck(scrapeJobId: string): () => Promise<void> {
  let lastCheckedAt = 0;
  let cancelled = false;

  return async () => {
    if (cancelled) throw new ScrapeCancelledError();
    if (Date.now() - lastCheckedAt < CANCEL_POLL_INTERVAL_MS) return;
    lastCheckedAt = Date.now();

    let job: ScrapeJob | null;
    try {
      job = await studioGet<ScrapeJob>("scrape_jobs", scrapeJobId);
    } catch (err) {
      // A failed poll must not kill a healthy run — the next checkpoint tries again.
      logger.warn({ err, scrapeJobId }, "could not check whether the scrape was cancelled");
      return;
    }

    // A job row deleted mid-run is as good as cancelled: there is nowhere left to report to.
    if (!job || isCancelledJob(job)) {
      cancelled = true;
      throw new ScrapeCancelledError();
    }
  };
}
