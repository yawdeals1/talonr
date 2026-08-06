import type { Page } from "playwright";
import { extractUserCells } from "../parsers/user-cell.parser.js";
import type { ScrapeSource } from "../types.js";

/** sourceRef is the raw search keyword/query string. */
export const searchSource: ScrapeSource = {
  buildUrl(sourceRef) {
    const params = new URLSearchParams({ q: sourceRef, src: "typed_query", f: "user" });
    return `https://x.com/search?${params.toString()}`;
  },
  async waitForReady(page: Page) {
    await page.waitForSelector('[data-testid="UserCell"]', { timeout: 15000 });
  },
  extractVisibleItems: extractUserCells,
};
