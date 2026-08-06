import type { Page } from "playwright";
import { extractUserCells } from "../parsers/user-cell.parser.js";
import type { ScrapeSource } from "../types.js";

/** sourceRef is the full tweet URL, e.g. https://x.com/handle/status/1234567890. */
export const likersSource: ScrapeSource = {
  buildUrl(sourceRef) {
    const trimmed = sourceRef.replace(/\/+$/, "");
    return trimmed.endsWith("/likes") ? trimmed : `${trimmed}/likes`;
  },
  async waitForReady(page: Page) {
    await page.waitForSelector('[data-testid="UserCell"]', { timeout: 15000 });
  },
  extractVisibleItems: extractUserCells,
};
