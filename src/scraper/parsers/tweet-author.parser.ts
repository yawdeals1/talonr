import type { Page } from "playwright";
import type { RawLead } from "../types.js";

/**
 * Extracts the author of each tweet in a thread (the original tweet plus its replies). Replies
 * render as full article[data-testid="tweet"] elements, not the UserCell markup search/followers/
 * retweeters lists use, and each one's [data-testid="User-Name"] includes a trailing "· <date>"
 * that has to be stripped to get a clean display name.
 */
export async function extractReplyAuthors(page: Page): Promise<RawLead[]> {
  return page.evaluate(() => {
    const root: ParentNode = document.querySelector('[data-testid="primaryColumn"]') ?? document;

    // X appends a "Discover more" / "More Tweets" block below a thread, built from the same
    // article[data-testid="tweet"] markup as the replies themselves. Those authors never engaged
    // with the tweet being scraped, so they must not be collected as repliers. The block is a
    // sibling of the real replies rather than a nested container, so it's identified by document
    // order relative to its heading. Mirrors the guard in user-cell.parser.ts (duplicated because
    // this runs in the page context, where a shared import isn't available).
    const SUGGESTION_LABEL = /discover more|more tweets|you might like|who to follow|recommended/i;

    const boundaryHeading = Array.from(root.querySelectorAll('[role="heading"], h1, h2, h3')).find(
      (heading) => SUGGESTION_LABEL.test(heading.textContent ?? "")
    );

    function inSuggestionModule(article: Element): boolean {
      if (article.closest('[data-testid="sidebarColumn"]')) return true;

      if (
        boundaryHeading &&
        boundaryHeading.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING
      ) {
        return true;
      }

      for (let node: Element | null = article, depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
        const label = node.getAttribute("aria-label");
        if (label && SUGGESTION_LABEL.test(label)) return true;
      }
      return false;
    }

    return Array.from(root.querySelectorAll('article[data-testid="tweet"]'))
      .map((article): RawLead | null => {
        if (inSuggestionModule(article)) return null;

        const links = Array.from(article.querySelectorAll('a[role="link"]')) as HTMLAnchorElement[];
        const profileLink = links.find((a) => /^\/[A-Za-z0-9_]{1,15}$/.test(new URL(a.href).pathname));
        const handle = profileLink ? profileLink.pathname.slice(1) : null;
        if (!handle) return null;

        const nameEl = article.querySelector('[data-testid="User-Name"]');
        const bioEl = article.querySelector('[data-testid="UserDescription"]');
        const avatarEl = article.querySelector('img[src*="profile_images"]') as HTMLImageElement | null;
        const verified = Boolean(article.querySelector('svg[data-testid="icon-verified"]'));

        const rawName = nameEl?.textContent?.trim() ?? null;
        const displayName = rawName
          ? rawName.split("·")[0]!.replace(new RegExp(`@${handle}$`, "i"), "").trim() || null
          : null;

        return {
          handle,
          displayName,
          bio: bioEl?.textContent?.trim() ?? null,
          followers: null,
          location: null,
          verified,
          profileImage: avatarEl?.src ?? null,
        };
      })
      .filter((lead): lead is RawLead => lead !== null);
  });
}
