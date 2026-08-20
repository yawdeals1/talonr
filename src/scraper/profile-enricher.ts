import type { Page } from "playwright";
import { logger } from "../lib/logger.js";
import { checkHealth, watchForRateLimitResponses } from "./detectors.js";
import {
  attachPartialLeads,
  isAccountHealthError,
  isScrapeCancelledError,
  RateLimitedError,
  type RawLead,
} from "./types.js";

interface ProfileDetails {
  displayName: string | null;
  bio: string | null;
  /**
   * Every rendering of the follower count found on the stats link, most-precise-first not
   * guaranteed — `pickFollowerCount` decides. X puts the rounded value in the visible text
   * ("51.1K") and the exact one in a `title`/`aria-label` on a *descendant* span ("51,132"), so
   * this collects the anchor's own attributes, its descendants' attributes, and its text.
   */
  followersCandidates: string[];
  location: string | null;
  verified: boolean;
  profileImage: string | null;
}

export interface ProfileEnrichmentOptions {
  minDelayMs: number;
  maxDelayMs: number;
  /**
   * Stop as soon as `count` visited leads satisfy `matches`. Set when the scrape carries a result
   * filter, so a "100–2000 followers" run keeps visiting candidates until it has that many
   * *matching* leads instead of spending its whole budget on the first N accounts in the list.
   * Leads that don't match are still returned (and saved) — filtering steers the run, it never
   * discards what was already scraped.
   */
  target?: {
    matches: (lead: RawLead) => boolean;
    count: number;
  };
  /**
   * Checkpoint called before each profile visit; throws `ScrapeCancelledError` once the user has
   * cancelled the run. Enrichment is the long tail of a scrape (one page load per lead), so this
   * is where a cancel usually lands.
   */
  shouldCancel?: () => Promise<void>;
}

// One extra visit for a profile whose header never rendered. X's profile header hydrates after
// domcontentloaded, and a lead whose follower count came back null is invisible to every
// follower-range filter — worth one retry, not worth an unbounded loop against a site we're
// deliberately keeping request volume low against.
const PROFILE_ATTEMPTS = 2;

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
 * X shows the count rounded in the link text ("6.4M", "1.2K") and exact in a title/aria-label
 * ("6,412,338 Followers"). Reading the rounded one made follower-range filters compare against a
 * bucket rather than the real number — an account with 999 followers renders as "1K", stores as
 * 1000, and then passes a `minFollowers: 1000` filter it should have failed. More digits in the
 * source string means less rounding, so that wins.
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
        followersCandidates: [] as string[],
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

    // The exact count lives on a *descendant* of the stats link, not on the anchor itself —
    // X renders `<a href="/x/verified_followers"><span title="51,132">51.1K</span> Followers</a>`.
    // Only reading the anchor's own attributes meant every account over ~10k was stored rounded to
    // three significant digits (51,132 saved as 51,100), which a follower-range bound then
    // compared against.
    const followersCandidates: string[] = [];
    if (followerLink) {
      for (const node of [followerLink, ...Array.from(followerLink.querySelectorAll("*"))]) {
        for (const attribute of ["aria-label", "title"]) {
          const value = node.getAttribute(attribute);
          if (value) followersCandidates.push(value);
        }
      }
      const text = followerLink.textContent?.trim();
      if (text) followersCandidates.push(text);
    }
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
      followersCandidates,
      location,
      verified: Boolean(userName?.querySelector('svg[data-testid="icon-verified"]')),
      profileImage,
    };
  }, handle);
}

/**
 * Loads one profile and reads it, waiting for the header block that carries the stats row.
 *
 * `UserName` alone isn't a sufficient hydration gate: it renders before the follower/following
 * counts do, so extracting on it produced leads with a null follower count — which every
 * follower-range filter then excludes, silently losing the lead.
 */
async function visitProfile(page: Page, handle: string): Promise<ProfileDetails> {
  await page.goto(`https://x.com/${encodeURIComponent(handle)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await checkHealth(page);
  await page.waitForSelector('[data-testid="UserName"]', { timeout: 15_000 });
  // Best-effort: a suspended or restricted profile renders a name and no stats at all, and that's
  // a legitimate result rather than a failure.
  await page
    .waitForSelector(
      '[data-testid="primaryColumn"] a[href$="/followers"], [data-testid="primaryColumn"] a[href$="/verified_followers"]',
      { timeout: 10_000 }
    )
    .catch(() => undefined);
  await checkHealth(page);

  return extractProfileDetails(page, handle);
}

function mergeProfileDetails(lead: RawLead, details: ProfileDetails): RawLead {
  return {
    ...lead,
    displayName: details.displayName ?? lead.displayName,
    bio: details.bio ?? lead.bio,
    followers: pickFollowerCount(...details.followersCandidates) ?? lead.followers,
    location: details.location ?? lead.location,
    verified: lead.verified || details.verified,
    profileImage: details.profileImage ?? lead.profileImage,
  };
}

/**
 * Visits collected leads' profiles in sequence and merges profile-only fields before the scrape is
 * written. A missing/suspended profile leaves the list-view data intact; account-health signals
 * remain terminal so the worker can checkpoint the X account instead of retrying blindly.
 *
 * Returns only the leads it actually visited. With `options.target` set it stops as soon as enough
 * of them match, so the caller can hand in a larger candidate pool than it needs and let the
 * filter decide where the run ends. Whatever it managed to enrich before an account-health error
 * rides out on the error as partials, so a throttled run still reports the leads it got.
 */
export async function enrichLeadsFromProfiles(
  page: Page,
  leads: RawLead[],
  options: ProfileEnrichmentOptions
): Promise<RawLead[]> {
  const enriched: RawLead[] = [];
  let matched = 0;
  let rateLimitStatus: number | null = null;
  const stopWatching = watchForRateLimitResponses(page, (status) => {
    rateLimitStatus = status;
  });

  try {
    for (const [index, lead] of leads.entries()) {
      let result = lead;

      for (let attempt = 1; attempt <= PROFILE_ATTEMPTS; attempt += 1) {
        try {
          await options.shouldCancel?.();
          if (rateLimitStatus !== null) throw new RateLimitedError(`X returned HTTP ${rateLimitStatus}`);
          result = mergeProfileDetails(lead, await visitProfile(page, lead.handle));
          if (result.followers !== null) break;

          // The header rendered without a follower count — either the profile genuinely has no
          // stats row (suspended/restricted) or it hadn't finished hydrating. One reload tells
          // the two apart cheaply.
          if (attempt < PROFILE_ATTEMPTS) {
            logger.debug({ handle: lead.handle }, "no follower count on profile; retrying once");
            await randomDelay(options.minDelayMs, options.maxDelayMs);
          }
        } catch (err) {
          // Both of these end the whole run rather than this one profile, and both carry the
          // already-enriched leads out so the worker can still save them.
          if (isAccountHealthError(err) || isScrapeCancelledError(err)) {
            attachPartialLeads(err, enriched);
            throw err;
          }
          if (attempt < PROFILE_ATTEMPTS) {
            logger.debug({ err, handle: lead.handle }, "profile visit failed; retrying once");
            await randomDelay(options.minDelayMs, options.maxDelayMs);
            continue;
          }
          logger.warn({ err, handle: lead.handle }, "profile enrichment failed; keeping collected lead data");
        }
      }

      enriched.push(result);
      if (options.target && options.target.matches(result)) {
        matched += 1;
        if (matched >= options.target.count) break;
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
