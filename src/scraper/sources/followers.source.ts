import type { Page } from "playwright";
import { extractUserCells } from "../parsers/user-cell.parser.js";
import { X_HANDLE_PATTERN, type RawLead, type ScrapeSource } from "../types.js";

/** sourceRef is the target account's handle (without @). */
export const followersSource: ScrapeSource = {
  buildUrl(sourceRef) {
    if (!X_HANDLE_PATTERN.test(sourceRef)) {
      throw new Error("sourceRef must be an X handle (letters, numbers, underscore, max 15 chars)");
    }
    const handle = sourceRef.replace(/^@/, "");
    return `https://x.com/${encodeURIComponent(handle)}/followers`;
  },
  async waitForReady(page: Page) {
    await page.waitForSelector('[data-testid="UserCell"]', { timeout: 15000 });
  },
  async extractVisibleItems(page: Page): Promise<RawLead[]> {
    // The target renders in the page's own header and in X's recommendation modules, but an
    // account never follows itself — drop it by matching the handle in the URL rather than by DOM
    // position, which shifts as more followers scroll in.
    const targetHandle = new URL(page.url()).pathname.split("/")[1];
    return extractUserCells(page, { excludeHandles: targetHandle ? [targetHandle] : [] });
  },
};
