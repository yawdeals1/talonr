import type { Page } from "playwright";
import { extractUserCells } from "../parsers/user-cell.parser.js";
import { X_TWEET_URL_PATTERN, type ScrapeSource } from "../types.js";

/** sourceRef is the full tweet URL, e.g. https://x.com/handle/status/1234567890. */
export const likersSource: ScrapeSource = {
  buildUrl(sourceRef) {
    // sourceRef is validated at job-creation time (scrapes.controller.ts), but this module drives
    // page.goto() directly inside the worker's authenticated Playwright session — re-checking here
    // means it can never navigate to an attacker-controlled URL (SSRF) even if a job somehow got
    // queued with unvalidated data.
    if (!X_TWEET_URL_PATTERN.test(sourceRef)) {
      throw new Error("sourceRef must be a full x.com/twitter.com tweet URL");
    }
    const trimmed = sourceRef.split(/[?#]/)[0]!.replace(/\/+$/, "");
    return trimmed.endsWith("/likes") ? trimmed : `${trimmed}/likes`;
  },
  async waitForReady(page: Page) {
    await page.waitForSelector('[data-testid="UserCell"]', { timeout: 15000 });
  },
  extractVisibleItems: extractUserCells,
};
