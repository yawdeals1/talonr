import type { Page } from "playwright";
import type { RawLead } from "../types.js";

/**
 * X reuses the same UserCell-style component for search results, followers lists, and likers
 * lists, so all three source modules share this extractor.
 */
export async function extractUserCells(page: Page): Promise<RawLead[]> {
  return page.$$eval('[data-testid="UserCell"]', (cells) => {
    return cells
      .map((cell): RawLead | null => {
        const handleEl = cell.querySelector('a[href^="/"] span');
        const links = Array.from(cell.querySelectorAll('a[role="link"]')) as HTMLAnchorElement[];
        const profileLink = links.find((a) => /^\/[A-Za-z0-9_]{1,15}$/.test(new URL(a.href).pathname));
        const handle = profileLink ? profileLink.pathname.slice(1) : null;
        if (!handle) return null;

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
  });
}
