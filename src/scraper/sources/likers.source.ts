import type { Page } from "playwright";
import { extractUserCells } from "../parsers/user-cell.parser.js";
import { X_TWEET_URL_PATTERN, type RawLead, type ScrapeSource } from "../types.js";

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
    // Land on the tweet itself, not a cold-loaded .../likes URL. X's likers list is a
    // client-side overlay reached by clicking the tweet's own "Likes" stat — a fresh
    // page.goto straight to .../likes never mounts that overlay, so the only
    // [data-testid="UserCell"]-shaped element on the page ends up being the tweet's own
    // author header, and every scrape "found" exactly one lead: the tweet's author.
    return sourceRef.split(/[?#]/)[0]!.replace(/\/+$/, "").replace(/\/likes$/, "");
  },
  async waitForReady(page: Page) {
    const tweet = page.locator('article[data-testid="tweet"]').first();
    await tweet.waitFor({ timeout: 15000 });
    await tweet.locator('a[href$="/likes"]').click({ timeout: 15000 });
    await page.waitForSelector('[data-testid="UserCell"]', { timeout: 15000 });
  },
  async extractVisibleItems(page: Page): Promise<RawLead[]> {
    // The tweet's own author header can still be mounted in the DOM behind the likers
    // overlay (it's a modal, not a full navigation) and shares the UserCell markup — drop
    // it so the tweet's author never gets counted as one of its own likers.
    const authorHandle = new URL(page.url()).pathname.split("/")[1]?.toLowerCase();
    const items = await extractUserCells(page);
    return authorHandle ? items.filter((item) => item.handle.toLowerCase() !== authorHandle) : items;
  },
};
