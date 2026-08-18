import type { Page } from "playwright";
import type { RawLead } from "../types.js";

export interface ExtractUserCellsOptions {
  /**
   * Handles to drop from the result (with or without a leading "@", case-insensitive) — e.g. the
   * account whose followers list is being scraped, which X also renders in the page header.
   */
  excludeHandles?: string[];
}

/**
 * X reuses the same UserCell-style component for search results, followers lists, and retweeter
 * lists, so those source modules share this extractor.
 *
 * Extraction is scoped to the primary column and skips X's recommendation modules on purpose. The
 * right-hand sidebar's "Who to follow" panel and the "You might like" block X splices into a
 * followers timeline are built from the *same* `[data-testid="UserCell"]` component as the real
 * list, so a document-wide query silently mixed suggested accounts into every scrape — a followers
 * scrape came back containing accounts that don't follow the target at all, re-collected on every
 * scroll round because the sidebar never scrolls away.
 */
export async function extractUserCells(
  page: Page,
  options: ExtractUserCellsOptions = {}
): Promise<RawLead[]> {
  const excludeHandles = (options.excludeHandles ?? []).map((handle) =>
    handle.replace(/^@/, "").toLowerCase()
  );

  return page.evaluate((excluded: string[]) => {
    // Fall back to the whole document only if X's layout shell is missing entirely — better to
    // over-collect than to return nothing if the testid is ever renamed.
    const root: ParentNode = document.querySelector('[data-testid="primaryColumn"]') ?? document;
    const excludedSet = new Set(excluded);

    // Recommendation modules aren't uniquely testid'd, so they're identified two ways, both
    // deliberately conservative — a miss just keeps the cell, which is the pre-existing behaviour,
    // whereas an over-match would silently discard real leads.
    //   1. an ancestor carrying a recommendation aria-label (the sidebar panel and X's labelled
    //      in-timeline carousels), and
    //   2. anything rendered after an in-timeline recommendation heading, since X appends those
    //      blocks as siblings of the real list rather than nesting them in a labelled container.
    const SUGGESTION_LABEL = /who to follow|you might like|suggested for you|discover more|recommended/i;

    const boundaryHeading = Array.from(root.querySelectorAll('[role="heading"], h1, h2, h3')).find(
      (heading) => SUGGESTION_LABEL.test(heading.textContent ?? "")
    );

    function inSuggestionModule(cell: Element): boolean {
      if (cell.closest('[data-testid="sidebarColumn"]')) return true;

      if (
        boundaryHeading &&
        boundaryHeading.compareDocumentPosition(cell) & Node.DOCUMENT_POSITION_FOLLOWING
      ) {
        return true;
      }

      for (let node: Element | null = cell, depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
        const label = node.getAttribute("aria-label");
        if (label && SUGGESTION_LABEL.test(label)) return true;
      }
      return false;
    }

    return Array.from(root.querySelectorAll('[data-testid="UserCell"]'))
      .map((cell): RawLead | null => {
        if (inSuggestionModule(cell)) return null;

        const handleEl = cell.querySelector('a[href^="/"] span');
        const links = Array.from(cell.querySelectorAll('a[role="link"]')) as HTMLAnchorElement[];
        const profileLink = links.find((a) => /^\/[A-Za-z0-9_]{1,15}$/.test(new URL(a.href).pathname));
        const handle = profileLink ? profileLink.pathname.slice(1) : null;
        if (!handle) return null;
        if (excludedSet.has(handle.toLowerCase())) return null;

        const nameEl = cell.querySelector('[data-testid="User-Name"] span');
        const bioEl = cell.querySelector('[data-testid="UserDescription"]');
        const avatarEl = cell.querySelector('img[src*="profile_images"]') as HTMLImageElement | null;
        const verified = Boolean(cell.querySelector('svg[data-testid="icon-verified"]'));

        return {
          handle,
          displayName: nameEl?.textContent?.trim() ?? handleEl?.textContent?.trim() ?? null,
          bio: bioEl?.textContent?.trim() ?? null,
          followers: null,
          location: null,
          verified,
          profileImage: avatarEl?.src ?? null,
        };
      })
      .filter((lead): lead is RawLead => lead !== null);
  }, excludeHandles);
}
