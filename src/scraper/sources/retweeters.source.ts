import type { Page } from "playwright";
import { extractUserCells } from "../parsers/user-cell.parser.js";
import { X_TWEET_URL_PATTERN, type RawLead, type ScrapeSource } from "../types.js";

/**
 * sourceRef is the full tweet URL, e.g. https://x.com/handle/status/1234567890. Unlike likers
 * (X made "who liked a post" fully private platform-wide in June 2024, with no workaround —
 * see likers.source.ts's git history), retweets stay public: .../status/:id/retweets renders a
 * real, non-redirecting UserCell list — verified live 2026-08-08 against an authenticated
 * session.
 */
export const retweetersSource: ScrapeSource = {
  buildUrl(sourceRef) {
    // sourceRef is validated at job-creation time (scrapes.controller.ts), but this module drives
    // page.goto() directly inside the worker's authenticated Playwright session — re-checking here
    // means it can never navigate to an attacker-controlled URL (SSRF) even if a job somehow got
    // queued with unvalidated data.
    if (!X_TWEET_URL_PATTERN.test(sourceRef)) {
      throw new Error("sourceRef must be a full x.com/twitter.com tweet URL");
    }
    const trimmed = sourceRef.split(/[?#]/)[0]!.replace(/\/+$/, "").replace(/\/(likes|retweets)$/, "");
    return `${trimmed}/retweets`;
  },
  async waitForReady(page: Page) {
    await page.waitForSelector('[data-testid="UserCell"]', { timeout: 15000 });
  },
  async extractVisibleItems(page: Page): Promise<RawLead[]> {
    // Same exclusion the repliers source applies: the tweet's own author isn't an engager to
    // collect, and X surfaces them around this list.
    const authorHandle = new URL(page.url()).pathname.split("/")[1];
    return extractUserCells(page, { excludeHandles: authorHandle ? [authorHandle] : [] });
  },
};
