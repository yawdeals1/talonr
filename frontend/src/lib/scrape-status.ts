import type { ScrapeJob } from "../api/types";
import type { PillStatus } from "../components/StatusPill";

/**
 * A cancelled scrape comes back as `failed` carrying exactly this message.
 *
 * `scrape_jobs.status` is a Postgres enum owned by a role the app's database connection isn't a
 * member of, so a `cancelled` value can't be added to it — the API encodes a cancel as the
 * existing terminal `failed` status plus this message (see src/modules/scrapes/scrape-cancel.ts,
 * which owns the same constant server-side). Keep the two in step.
 */
const CANCELLED_ERROR_MESSAGE = "Cancelled by user";

type JobStatusFields = Pick<ScrapeJob, "status" | "errorMessage">;

export function isCancelledScrape(job: JobStatusFields): boolean {
  return job.status === "failed" && job.errorMessage === CANCELLED_ERROR_MESSAGE;
}

/** What the status pill should read — a stopped run is not a failed one. */
export function scrapeDisplayStatus(job: JobStatusFields): PillStatus {
  return isCancelledScrape(job) ? "cancelled" : job.status;
}

/** Queued or running: the two states a scrape can still be stopped from. */
export function isCancellableScrape(job: JobStatusFields): boolean {
  return job.status === "queued" || job.status === "running";
}

/** Queued or running: the two states a scrape can be paused from. */
export function isPausableScrape(job: JobStatusFields): boolean {
  return job.status === "queued" || job.status === "running";
}

/**
 * Paused, whatever paused it — you, X's rate limit, or the account's daily quota. All three leave
 * the job in the same state needing the same thing, so they get the same button.
 */
export function isResumableScrape(job: JobStatusFields): boolean {
  return job.status === "paused";
}

/**
 * Over, and worth running again for more.
 *
 * Deliberately includes a cancelled and a failed run as well as a completed one: "give me more
 * leads from this target" is a reasonable thing to want after any ending except a pause, which has
 * Resume instead — that one keeps the same job rather than starting a new one.
 */
export function isContinuableScrape(job: JobStatusFields): boolean {
  return job.status === "completed" || job.status === "failed";
}
