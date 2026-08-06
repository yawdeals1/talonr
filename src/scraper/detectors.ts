import type { Page } from "playwright";
import { CaptchaDetectedError, LoginChallengeError, RateLimitedError } from "./types.js";

const CHALLENGE_URL_PATTERN = /\/(login|i\/flow\/login|account\/access|i\/flow\/lockdown|challenge)/;

/** Checks the current page for login walls, captchas, or rate-limit signals; throws a typed error if found. */
export async function checkHealth(page: Page): Promise<void> {
  const url = page.url();
  if (CHALLENGE_URL_PATTERN.test(url)) {
    throw new LoginChallengeError(url);
  }

  const captchaFrame = await page.$('iframe[src*="arkoselabs"], iframe[title*="challenge" i]');
  if (captchaFrame) {
    throw new CaptchaDetectedError();
  }

  const rateLimitHits = await page.getByText(/rate limit|something went wrong.*reload|try again later/i).count();
  if (rateLimitHits > 0) {
    throw new RateLimitedError();
  }
}

/** Attaches a response listener that flags HTTP-level rate-limit responses as they happen mid-scroll. */
export function watchForRateLimitResponses(page: Page, onRateLimited: (status: number) => void): () => void {
  const handler = (response: import("playwright").Response) => {
    if (response.status() === 429) {
      onRateLimited(response.status());
    }
  };
  page.on("response", handler);
  return () => page.off("response", handler);
}
