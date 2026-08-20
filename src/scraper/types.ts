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
   * Checkpoint the collector calls once per scroll round; it throws `ScrapeCancelledError` when
   * the user has cancelled the run. Injected as a callback so the scraper modules stay free of
   * database imports — the worker owns where the signal comes from.
   */
  shouldCancel?: () => Promise<void>;
}

export interface ScrapeSource {
  buildUrl(sourceRef: string): string;
  waitForReady(page: Page): Promise<void>;
  extractVisibleItems(page: Page): Promise<RawLead[]>;
}

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
