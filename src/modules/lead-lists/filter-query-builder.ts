import type { FilterDefinition, Lead } from "../../db/schema.js";

/**
 * Translates a stored FilterDefinition into an in-process predicate, evaluated against the
 * already-scraped `leads` table at read time (leads are written unfiltered at scrape time). The
 * Studio API has no ILIKE/range filter support, so this runs in the Node process instead of
 * compiling to SQL — acceptable for a personal-scale project's data volumes, not for a large one.
 * Rows with a null `followers` value are excluded from min/max-follower filters rather than
 * matching, since list-view scraping frequently can't populate follower counts.
 */
export function buildFilterPredicate(filter: FilterDefinition): (lead: Lead) => boolean {
  return (lead) => {
    if (filter.bioKeywords && filter.bioKeywords.length > 0) {
      const bio = lead.bio?.toLowerCase() ?? "";
      if (!filter.bioKeywords.some((keyword) => bio.includes(keyword.toLowerCase()))) return false;
    }

    if (filter.minFollowers !== undefined) {
      if (lead.followers === null || lead.followers < filter.minFollowers) return false;
    }

    if (filter.maxFollowers !== undefined) {
      if (lead.followers === null || lead.followers > filter.maxFollowers) return false;
    }

    if (filter.location) {
      if (!lead.location?.toLowerCase().includes(filter.location.toLowerCase())) return false;
    }

    if (filter.verifiedOnly && !lead.verified) return false;

    return true;
  };
}
