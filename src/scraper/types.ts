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

export function isAccountHealthError(
  err: unknown
): err is LoginChallengeError | CaptchaDetectedError | RateLimitedError {
  return (
    err instanceof LoginChallengeError || err instanceof CaptchaDetectedError || err instanceof RateLimitedError
  );
}
