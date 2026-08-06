import { and, eq, gte, ilike, isNotNull, lte, or, type SQL } from "drizzle-orm";
import { leads } from "../../db/schema.js";
import type { FilterDefinition } from "../../db/schema.js";

/**
 * Translates a stored FilterDefinition into a drizzle `where` clause, evaluated against the
 * already-scraped `leads` table at read time (leads are written unfiltered at scrape time).
 * Rows with a null `followers` value are excluded from min/max-follower filters rather than
 * erroring, since list-view scraping frequently can't populate follower counts.
 */
export function buildFilterCondition(filter: FilterDefinition): SQL | undefined {
  const conditions: SQL[] = [];

  if (filter.bioKeywords && filter.bioKeywords.length > 0) {
    const bioConditions = filter.bioKeywords.map((keyword) => ilike(leads.bio, `%${keyword}%`));
    const combined = or(...bioConditions);
    if (combined) conditions.push(combined);
  }

  if (filter.minFollowers !== undefined) {
    conditions.push(isNotNull(leads.followers));
    conditions.push(gte(leads.followers, filter.minFollowers));
  }

  if (filter.maxFollowers !== undefined) {
    conditions.push(isNotNull(leads.followers));
    conditions.push(lte(leads.followers, filter.maxFollowers));
  }

  if (filter.location) {
    conditions.push(ilike(leads.location, `%${filter.location}%`));
  }

  if (filter.verifiedOnly) {
    conditions.push(eq(leads.verified, true));
  }

  return and(...conditions);
}
