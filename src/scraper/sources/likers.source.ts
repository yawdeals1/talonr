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
    const trimmed = sourceRef.split(/[?#]/)[0]!.replace(/\/+$/, "");
    return trimmed.endsWith("/likes") ? trimmed : `${trimmed}/likes`;
  },
  async waitForReady(page: Page) {
    await page.waitForSelector('[data-testid="UserCell"], article[data-testid="tweet"]', { timeout: 15000 });
    // Verified live (2026-08-08, against a real tweet, in an authenticated session): X silently
    // bounces .../status/:id/likes back to the base tweet URL instead of rendering the likers
    // list — reproduced on a fresh page.goto, and again via a simulated in-app route transition,
    // so it isn't a "cold nav vs. client nav" issue. Cause is unconfirmed (X Premium-gating the
    // likers list, or a client-router regression on X's end are both plausible), but either way
    // this app has no working path to the real list right now. Without this check, the page just
    // silently shows the tweet's own author in the "Relevant people" sidebar — which shares the
    // UserCell markup — and every scrape "found" exactly one lead: the tweet's author. Fail
    // loudly instead of shipping that mislabeled data.
    if (!page.url().replace(/\/+$/, "").endsWith("/likes")) {
      throw new Error(
        "X did not show the likers list for this tweet (it redirected back to the tweet itself) — " +
          "likers scraping isn't currently working against X's web client"
      );
    }
    await page.waitForSelector('[data-testid="UserCell"]', { timeout: 15000 });
  },
  async extractVisibleItems(page: Page): Promise<RawLead[]> {
    // Defense in depth: if X's own header/sidebar author card is ever still mounted alongside a
    // genuine likers list, don't let the tweet's author masquerade as one of its own likers.
    const authorHandle = new URL(page.url()).pathname.split("/")[1]?.toLowerCase();
    const items = await extractUserCells(page);
    return authorHandle ? items.filter((item) => item.handle.toLowerCase() !== authorHandle) : items;
  },
};
