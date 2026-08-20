import type { FilterDefinition, Lead } from "../../db/schema.js";
import type { RawLead } from "../../scraper/types.js";

/**
 * The fields a filter actually looks at. Kept structural rather than `Lead` so the *same*
 * predicate can also be run against a `RawLead` mid-scrape (see scrape.worker.ts), which is what
 * makes a follower range steer collection instead of only hiding rows afterwards. A `RawLead` has
 * no `id` yet, so `leadIds` — the only field a raw lead can't satisfy — is optional here.
 */
export type FilterableLead = Pick<RawLead, "bio" | "followers" | "location" | "verified"> & {
  id?: string;
};

/**
 * Reads a follower count defensively.
 *
 * The Studio DB is a REST API, not a typed driver: a count can come back as a number, as a numeric
 * string (how pg renders bigint/numeric), as null, or be absent from the row entirely. Comparing
 * `undefined` against a bound is silently false in *both* directions, so an unknown count used to
 * satisfy a min and a max at once and slip through a range filter it should never have matched.
 * Anything that isn't a finite number is "unknown".
 */
function followerCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Translates a stored FilterDefinition into an in-process predicate, evaluated against the
 * already-scraped `leads` table at read time (leads are written unfiltered at scrape time). The
 * Studio API has no ILIKE/range filter support, so this runs in the Node process instead of
 * compiling to SQL — acceptable for a personal-scale project's data volumes, not for a large one.
 * Rows with an unknown `followers` value are excluded from min/max-follower filters rather than
 * matching, since a profile visit can fail and leave the count null.
 */
export function buildFilterPredicate(filter: FilterDefinition): (lead: FilterableLead & Partial<Lead>) => boolean {
  const selectedLeadIds = filter.leadIds ? new Set(filter.leadIds) : null;
  return (lead) => {
    if (selectedLeadIds && (lead.id === undefined || !selectedLeadIds.has(lead.id))) return false;

    if (filter.bioKeywords && filter.bioKeywords.length > 0) {
      const bio = lead.bio?.toLowerCase() ?? "";
      if (!filter.bioKeywords.some((keyword) => bio.includes(keyword.toLowerCase()))) return false;
    }

    const followers = followerCount(lead.followers);

    // minFollowers === 0 is a no-op bound (every non-negative count already satisfies "at least
    // 0"), so it must not exclude leads with an unknown follower count the way a real lower bound
    // does — otherwise typing "0" as "no minimum" silently zeroes out every result.
    if (filter.minFollowers !== undefined && filter.minFollowers > 0) {
      if (followers === null || followers < filter.minFollowers) return false;
    }

    if (filter.maxFollowers !== undefined) {
      if (followers === null || followers > filter.maxFollowers) return false;
    }

    if (filter.location) {
      if (!lead.location?.toLowerCase().includes(filter.location.toLowerCase())) return false;
    }

    if (filter.verifiedOnly && !lead.verified) return false;

    return true;
  };
}
