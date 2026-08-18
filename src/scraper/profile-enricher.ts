import type { Page } from "playwright";
import { logger } from "../lib/logger.js";
import { checkHealth, watchForRateLimitResponses } from "./detectors.js";
import { isAccountHealthError, RateLimitedError, type RawLead } from "./types.js";

interface ProfileDetails {
  displayName: string | null;
  bio: string | null;
  // X renders the follower count twice on the stats link: rounded in the visible text ("6.4M")
  // and exact in aria-label/title ("6,412,338 Followers"). Both are returned so the caller can
  // prefer the exact one — see pickFollowerCount.
  followersLabel: string | null;
  followersText: string | null;
  location: string | null;
  verified: boolean;
  profileImage: string | null;
}

export interface ProfileEnrichmentOptions {
  minDelayMs: number;
  maxDelayMs: number;
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * Math.max(0, maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/** Parses X's compact follower labels (for example 1,234, 12.5K, 3M, or 1.2B). */
export function parseFollowerCount(value: string | null): number | null {
  if (!value) return null;
  const match = value.replace(/\s/g, "").match(/([\d,.]+)([KMB])?/i);
  if (!match) return null;

  const number = Number.parseFloat(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;

  const multiplier =
    match[2]?.toUpperCase() === "K"
      ? 1_000
      : match[2]?.toUpperCase() === "M"
        ? 1_000_000
        : match[2]?.toUpperCase() === "B"
          ? 1_000_000_000
          : 1;
  return Math.round(number * multiplier);
}

/**
 * Picks the most precise follower count among several renderings of the same number.
 *
 * X shows the count rounded in the link text ("6.4M", "1.2K") and exact in the link's
 * aria-label/title ("6,412,338 Followers"). Reading the rounded one made follower-range filters
 * compare against a bucket rather than the real number — an account with 999 followers renders as
 * "1K", stores as 1000, and then passes a `minFollowers: 1000` filter it should have failed.
 * More digits in the source string means less rounding, so that wins.
 */
export function pickFollowerCount(...candidates: (string | null)[]): number | null {
  let best: number | null = null;
  let bestDigits = -1;

  for (const candidate of candidates) {
    const parsed = parseFollowerCount(candidate);
    if (parsed === null || candidate === null) continue;
    const digits = (candidate.match(/\d/g) ?? []).length;
    if (digits > bestDigits) {
      best = parsed;
      bestDigits = digits;
    }
  }

  return best;
}

async function extractProfileDetails(page: Page, handle: string): Promise<ProfileDetails> {
  return page.evaluate((profileHandle) => {
    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]') ?? document.querySelector("main");
    if (!primaryColumn) {
      return {
        displayName: null,
        bio: null,
        followersLabel: null,
        followersText: null,
        location: null,
        verified: false,
        profileImage: null,
      };
    }

    const userName = primaryColumn.querySelector('[data-testid="UserName"]');
    // Must be *this* profile's followers link. X also renders "Followers you know" and similar
    // modules that link to other accounts' follower lists inside the same column.
    const followerLink = Array.from(primaryColumn.querySelectorAll<HTMLAnchorElement>("a[href]")).find((anchor) => {
      const segments = new URL(anchor.href).pathname.replace(/\/+$/, "").split("/");
      if (segments.length !== 3) return false;
      const [, owner, section] = segments;
      if (owner?.toLowerCase() !== profileHandle.toLowerCase()) return false;
      return section === "followers" || section === "verified_followers";
    });
    const displayName = userName?.querySelector("span")?.textContent?.trim() || null;
    const bio = primaryColumn.querySelector('[data-testid="UserDescription"]')?.textContent?.trim() || null;
    const location = primaryColumn.querySelector('[data-testid="UserLocation"]')?.textContent?.trim() || null;
    const avatarContainer = Array.from(
      primaryColumn.querySelectorAll<HTMLElement>('[data-testid^="UserAvatar-Container-"]')
    ).find((element) => element.dataset.testid?.slice("UserAvatar-Container-".length).toLowerCase() === profileHandle.toLowerCase());
    const profileImage =
      (avatarContainer?.querySelector('img[src*="profile_images"]') as HTMLImageElement | null)?.src ?? null;

    return {
      displayName,
      bio,
      followersLabel:
        followerLink?.getAttribute("aria-label") ?? followerLink?.getAttribute("title") ?? null,
      followersText: followerLink?.textContent?.trim() || null,
      location,
      verified: Boolean(userName?.querySelector('svg[data-testid="icon-verified"]')),
      profileImage,
    };
  }, handle);
}

/**
 * Visits every collected lead's profile in sequence and merges profile-only fields before the
 * scrape is written. A missing/suspended profile leaves the list-view data intact; account-health
 * signals remain terminal so the worker can checkpoint the X account instead of retrying blindly.
 */
export async function enrichLeadsFromProfiles(
  page: Page,
  leads: RawLead[],
  options: ProfileEnrichmentOptions
): Promise<RawLead[]> {
  const enriched: RawLead[] = [];
  let rateLimitStatus: number | null = null;
  const stopWatching = watchForRateLimitResponses(page, (status) => {
    rateLimitStatus = status;
  });

  try {
    for (const [index, lead] of leads.entries()) {
      try {
        await page.goto(`https://x.com/${encodeURIComponent(lead.handle)}`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        if (rateLimitStatus !== null) throw new RateLimitedError(`X returned HTTP ${rateLimitStatus}`);
        await checkHealth(page);
        await page.waitForSelector('[data-testid="UserName"]', { timeout: 15_000 });
        await checkHealth(page);

        const details = await extractProfileDetails(page, lead.handle);
        enriched.push({
          ...lead,
          displayName: details.displayName ?? lead.displayName,
          bio: details.bio ?? lead.bio,
          followers: pickFollowerCount(details.followersLabel, details.followersText) ?? lead.followers,
          location: details.location ?? lead.location,
          verified: lead.verified || details.verified,
          profileImage: details.profileImage ?? lead.profileImage,
        });
      } catch (err) {
        if (isAccountHealthError(err)) throw err;
        logger.warn({ err, handle: lead.handle }, "profile enrichment failed; keeping collected lead data");
        enriched.push(lead);
      }

      if (index < leads.length - 1) {
        await randomDelay(options.minDelayMs, options.maxDelayMs);
      }
    }
  } finally {
    stopWatching();
  }

  return enriched;
}
