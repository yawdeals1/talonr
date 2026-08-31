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

    // Recommendation modules aren't uniquely testid'd, so they're identified by an ancestor
    // carrying a recommendation aria-label — the sidebar panel and X's labelled in-timeline
    // carousels both wrap their cells in such a container. Deliberately conservative: a miss just
    // keeps the cell, which is the pre-existing behaviour, whereas an over-match would silently
    // discard real leads.
    //
    // Unlike tweet-author.parser.ts's "Discover more" block — which is genuinely terminal, the last
    // thing on a finished thread — a followers/search list is an endless scroll, and X splices an
    // interstitial "You might also follow" card mid-list on large accounts while real followers keep
    // rendering below it as the run scrolls further. A "everything after this heading" rule (as
    // tweet-author.parser.ts uses) would discard every one of those later, genuine followers for the
    // rest of the run — which is what silently stalled a 64.7K-follower account at 6 collected leads
    // before the stagnant-round counter gave up. Only the ancestor check is safe here.
    const SUGGESTION_LABEL = /who to follow|you might like|suggested for you|discover more|recommended/i;

    function inSuggestionModule(cell: Element): boolean {
      if (cell.closest('[data-testid="sidebarColumn"]')) return true;

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
        // Every anchor in the cell, not only the ones carrying role="link". X does put that role on
        // its profile anchors today, but the attribute is a presentational detail of one React
        // component, and requiring it means a markup change silently drops every cell it touches —
        // which looks from the outside exactly like a followers list that ran dry. The path shape
        // below is the real test of "is this a profile link", so the role adds nothing but a way to
        // fail. Anything without a parseable href is skipped rather than thrown on.
        const links = (Array.from(cell.querySelectorAll("a[href]")) as HTMLAnchorElement[]).filter(
          // A bio's @mentions are handle-shaped links to somebody else entirely. They sit below the
          // cell's own avatar/name anchors so they were never reached first, but excluding them
          // outright means that stays true even if X reorders the cell.
          (anchor) => !anchor.closest('[data-testid="UserDescription"]')
        );
        const profileLink = links.find((anchor) => {
          try {
            return /^\/[A-Za-z0-9_]{1,15}$/.test(new URL(anchor.href, document.baseURI).pathname);
          } catch {
            return false;
          }
        });
        const handle = profileLink ? new URL(profileLink.href, document.baseURI).pathname.slice(1) : null;
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
