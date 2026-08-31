import type { Page } from "playwright";

// sourceRef format guards, shared between scrapes.controller.ts (rejects bad input before a job
// is ever enqueued) and the source modules themselves (defense in depth against SSRF — sourceRef
// ends up in page.goto() inside the worker's Playwright browser, so it must never be an arbitrary
// attacker-controlled URL).
export const X_HANDLE_PATTERN = /^@?[A-Za-z0-9_]{1,15}$/;
export const X_TWEET_URL_PATTERN =
  /^https:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status\/\d+(?:\/likes)?\/?(?:[?#].*)?$/;

export interface RawLead {
  handle: string;
  displayName: string | null;
  bio: string | null;
  // List views leave these null; the worker's profile-enrichment phase fills them before upsert.
  // They stay nullable because profiles can omit a location or be temporarily unavailable.
  followers: number | null;
  location: string | null;
  verified: boolean;
  profileImage: string | null;
}

export interface ScrapeSourceContext {
  page: Page;
  sourceRef: string;
  capLeads: number;
  minScrollDelayMs: number;
  maxScrollDelayMs: number;
  /**
   * Optional shared dedupe map. The "engagers" source type runs two sources (repliers, retweeters)
   * back to back and merges them; passing one map across both runs means a health error during the
   * second run still carries the first run's leads out as partials.
   */
  into?: Map<string, RawLead>;
  /**
   * Called once per scroll round to ask whether the run should keep going. It throws
   * `ScrapeCancelledError` on a cancel and returns "finish" when the user asked the run to wrap up
   * with what it has. Injected as a callback so the scraper modules stay free of database imports —
   * the worker owns where the signal comes from.
   */
  checkpoint?: () => Promise<"continue" | "finish">;
  /**
   * How many consecutive throttled rounds to tolerate — backing off between each — before ending
   * the run as rate-limited, and how long the first of those back-offs is. Passed in rather than
   * read from config here so the scraper modules stay free of env imports; the worker owns them
   * (RATE_LIMIT_TOLERANCE / RATE_LIMIT_BACKOFF_MS).
   */
  rateLimitTolerance?: number;
  rateLimitBackoffMs?: number;
  /**
   * How long one page load gets: the `goto` that opens the list, and (at half of it) the wait for
   * the list itself to render. Passed in rather than read from config here so the scraper modules
   * stay free of env imports; the worker owns it (SCRAPE_NAV_TIMEOUT_MS).
   */
  navTimeoutMs?: number;
  /** Called after each scroll round with the number of unique handles collected so far. */
  onProgress?: (collected: number) => void;
  /**
   * Longest a round waits for X to answer a scroll with more of the list before calling the round
   * stagnant. Passed in like the other timings so this module stays free of env imports, and so
   * tests don't sit through the real thing; the collector's own default applies when it is absent.
   */
  contentWaitMs?: number;
  /**
   * Handles a previous run already collected from this target, lowercased.
   *
   * A resumed or continued scrape scrolls back over the same accounts before it reaches new ones —
   * they are recognised here and neither counted toward `capLeads` nor handed on for a profile
   * visit, so "continue" means another `capLeads` *new* leads rather than the same page again.
   * Seeing one still counts as progress for the stagnation check (see scrollAndCollect): a run
   * scrolling through a thousand already-known followers is advancing, not stuck.
   */
  skipHandles?: Set<string>;
}

/**
 * Why a collection run stopped, so the job can say what it ran out of.
 *
 * A run that ends on the lead cap needs no explanation. Every other ending does, and until this
 * existed none of them produced one: a followers scrape whose list stopped yielding new accounts
 * after five completed with a green tick and no message at all, indistinguishable from a target
 * that genuinely only had five.
 */
export type CollectionStopReason =
  /** Collected the full candidate pool it was asked for. */
  | "cap"
  /** The user, or the run's own clock, said stop. */
  | "stopped"
  /** The page stopped scrolling and stopped producing: the end of the list. */
  | "exhausted"
  /** The page kept scrolling but stopped producing new accounts — X stopped serving us. */
  | "stalled";

export interface CollectionResult {
  leads: RawLead[];
  reason: CollectionStopReason;
  /** Scroll rounds run. */
  rounds: number;
  /** Accounts recognised as already collected by an earlier run and passed over. */
  skipped: number;
}

export interface ScrapeSource {
  buildUrl(sourceRef: string): string;
  /**
   * Waits for the view this source reads. `timeoutMs` is the caller's share of the run's page-load
   * budget — this is the wait that decides whether a page rendered, so it can't keep a fixed
   * bound of its own while the rest of the run's timings are configurable.
   */
  waitForReady(page: Page, timeoutMs?: number): Promise<void>;
  extractVisibleItems(page: Page): Promise<RawLead[]>;
}

/**
 * Fallbacks for the two page-load bounds, used when no caller passes one (tests, and any source
 * called outside a run). Production values come from SCRAPE_NAV_TIMEOUT_MS via the worker.
 */
export const DEFAULT_NAV_TIMEOUT_MS = 60_000;
export const DEFAULT_READY_TIMEOUT_MS = 15_000;

export class LoginChallengeError extends Error {
  constructor(url: string) {
    super(`Landed on a login/challenge page: ${url}`);
    this.name = "LoginChallengeError";
  }
}

export class CaptchaDetectedError extends Error {
  constructor() {
    super("Captcha challenge detected on page");
    this.name = "CaptchaDetectedError";
  }
}

export class RateLimitedError extends Error {
  constructor(detail = "Rate limit signal detected on page") {
    super(detail);
    this.name = "RateLimitedError";
  }
}

/**
 * X's generic client-side error boundary ("Something went wrong. Try reloading.") — deliberately
 * NOT an account-health error.
 *
 * It fires for any single failed request and is routinely on screen while the SPA is still
 * hydrating, which is exactly when the first checkHealth() runs. Classifying it as a rate-limit
 * signal checkpointed accounts that X had done nothing to: a checkpoint is terminal for the job and
 * `accounts.service.ts#updateAccount` refuses to flip the account back to `active`, so recovering
 * from one costs a full interactive re-login. Callers retry this instead.
 */
export class TransientPageError extends Error {
  constructor(detail: string) {
    super(`Transient page error: ${detail}`);
    this.name = "TransientPageError";
  }
}

/**
 * The user asked for this run to stop. Deliberately *not* an account-health error: X did nothing
 * wrong, so the account must not be checkpointed — and deliberately not a plain Error either, so
 * the worker can mark the job cancelled and skip BullMQ's attempts/backoff instead of retrying a
 * scrape someone just stopped.
 */
export class ScrapeCancelledError extends Error {
  constructor() {
    super("Scrape cancelled by user");
    this.name = "ScrapeCancelledError";
  }
}

export function isScrapeCancelledError(err: unknown): err is ScrapeCancelledError {
  return err instanceof ScrapeCancelledError;
}

export function isAccountHealthError(
  err: unknown
): err is LoginChallengeError | CaptchaDetectedError | RateLimitedError {
  return (
    err instanceof LoginChallengeError || err instanceof CaptchaDetectedError || err instanceof RateLimitedError
  );
}

// Leads already collected when a scrape is cut short. A health error mid-scroll used to propagate
// straight out of scrollAndCollect, discarding every lead gathered so far — a run stopped at lead
// 400 of 500 reported `leadsFound: 0`. They ride out on the error so the worker can still save them
// before it checkpoints the account.
interface PartialScrapeCarrier {
  partialLeads?: RawLead[];
  partialLeadsSaved?: number;
}

function asCarrier(err: unknown): PartialScrapeCarrier | null {
  return typeof err === "object" && err !== null ? (err as PartialScrapeCarrier) : null;
}

export function attachPartialLeads(err: unknown, leads: RawLead[]): void {
  const carrier = asCarrier(err);
  if (carrier && leads.length > 0) carrier.partialLeads = leads;
}

export function getPartialLeads(err: unknown): RawLead[] {
  return asCarrier(err)?.partialLeads ?? [];
}

export function setPartialLeadsSaved(err: unknown, count: number): void {
  const carrier = asCarrier(err);
  if (carrier) carrier.partialLeadsSaved = count;
}

export function getPartialLeadsSaved(err: unknown): number {
  return asCarrier(err)?.partialLeadsSaved ?? 0;
}
