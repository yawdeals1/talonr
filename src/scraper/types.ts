import type { Page } from "playwright";

export interface RawLead {
  handle: string;
  displayName: string | null;
  bio: string | null;
  // Rarely populated from list-view scraping — X's search/followers/likers cells don't expose
  // follower counts without visiting the profile page. Left null when unavailable.
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
