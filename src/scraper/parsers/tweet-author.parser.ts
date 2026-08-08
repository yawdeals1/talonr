import type { Page } from "playwright";
import type { RawLead } from "../types.js";

/**
 * Extracts the author of each tweet in a thread (the original tweet plus its replies). Replies
 * render as full article[data-testid="tweet"] elements, not the UserCell markup search/followers/
 * retweeters lists use, and each one's [data-testid="User-Name"] includes a trailing "· <date>"
 * that has to be stripped to get a clean display name.
 */
export async function extractReplyAuthors(page: Page): Promise<RawLead[]> {
  return page.$$eval('article[data-testid="tweet"]', (articles) => {
    return articles
      .map((article): RawLead | null => {
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
