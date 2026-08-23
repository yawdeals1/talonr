import type { Page } from "playwright";
import { extractReplyAuthors } from "../parsers/tweet-author.parser.js";
import { DEFAULT_READY_TIMEOUT_MS, X_TWEET_URL_PATTERN, type RawLead, type ScrapeSource } from "../types.js";

/** sourceRef is the full tweet URL, e.g. https://x.com/handle/status/1234567890. */
export const repliersSource: ScrapeSource = {
  buildUrl(sourceRef) {
    // sourceRef is validated at job-creation time (scrapes.controller.ts), but this module drives
    // page.goto() directly inside the worker's authenticated Playwright session — re-checking here
    // means it can never navigate to an attacker-controlled URL (SSRF) even if a job somehow got
    // queued with unvalidated data.
    if (!X_TWEET_URL_PATTERN.test(sourceRef)) {
      throw new Error("sourceRef must be a full x.com/twitter.com tweet URL");
    }
    return sourceRef.split(/[?#]/)[0]!.replace(/\/+$/, "").replace(/\/(likes|retweets)$/, "");
  },
  async waitForReady(page: Page, timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: timeoutMs });
  },
  async extractVisibleItems(page: Page): Promise<RawLead[]> {
    // The thread's first article is always the original tweet, not a reply — and the author may
    // also reply within their own thread — exclude both by matching the page's own handle rather
    // than relying on DOM order (which can shift once more replies scroll in).
    const authorHandle = new URL(page.url()).pathname.split("/")[1]?.toLowerCase();
    const items = await extractReplyAuthors(page);
    return authorHandle ? items.filter((item) => item.handle.toLowerCase() !== authorHandle) : items;
  },
};
