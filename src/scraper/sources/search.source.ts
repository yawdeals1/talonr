import type { Page } from "playwright";
import { extractUserCells } from "../parsers/user-cell.parser.js";
import { DEFAULT_READY_TIMEOUT_MS, type ScrapeSource } from "../types.js";

/** sourceRef is the raw search keyword/query string. */
export const searchSource: ScrapeSource = {
  buildUrl(sourceRef) {
    const params = new URLSearchParams({ q: sourceRef, src: "typed_query", f: "user" });
    return `https://x.com/search?${params.toString()}`;
  },
  async waitForReady(page: Page, timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
    await page.waitForSelector('[data-testid="UserCell"]', { timeout: timeoutMs });
  },
  extractVisibleItems: extractUserCells,
};
