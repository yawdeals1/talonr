import { studioDelete, studioGet, studioInsert, studioListSorted, studioUpdate } from "../../db/studio-client.js";
import { normalizeStudioSourceType } from "../../db/source-type-compat.js";
import type { FilterDefinition, Lead, LeadList } from "../../db/schema.js";
import { NotFoundError } from "../../lib/errors.js";
import { compareLeadsForDisplay } from "../leads/leads.service.js";
import { isInternalScrapeResultList } from "../scrapes/scrape-results.service.js";
import { buildFilterPredicate } from "./filter-query-builder.js";

// The id tiebreaker gives these a total order — the Studio API has no ORDER BY, so paged fetches
// arrive in an arbitrary order and ties would otherwise resolve differently per request. See
// leads.service.ts#compareLeadsForDisplay.
const byCreatedAtDesc = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

export async function listLeadLists(userId: string) {
  const lists = await studioListSorted<LeadList>("lead_lists", { filter: { userId } }, byCreatedAtDesc);
  return lists.filter((list) => !isInternalScrapeResultList(list));
}

async function findOwnedOrThrow(userId: string, id: string): Promise<LeadList> {
  const list = await studioGet<LeadList>("lead_lists", id);
  if (!list || list.userId !== userId || isInternalScrapeResultList(list)) {
    throw new NotFoundError("Lead list not found");
  }
  return list;
}

export async function getLeadList(userId: string, id: string) {
  return findOwnedOrThrow(userId, id);
}

export async function createLeadList(userId: string, name: string, filterDefinition: FilterDefinition) {
  return studioInsert<LeadList>("lead_lists", { userId, name, filterDefinition });
}

export async function updateLeadList(
  userId: string,
  id: string,
  input: Partial<{ name: string; filterDefinition: FilterDefinition }>
) {
  await findOwnedOrThrow(userId, id);
  return studioUpdate<LeadList>("lead_lists", id, input);
}

export async function deleteLeadList(userId: string, id: string) {
  await findOwnedOrThrow(userId, id);
  await studioDelete("lead_lists", id);
}

export async function evaluateLeadList(userId: string, id: string, page = 1, pageSize = 50) {
  const list = await findOwnedOrThrow(userId, id);
  const size = Math.min(pageSize, 200);
  const predicate = buildFilterPredicate(list.filterDefinition);

  // Every predicate field, including verifiedOnly, runs in-process via buildFilterPredicate.
  // verifiedOnly used to push down as a server-side `filter[verified]=true` equality filter, but
  // that was the only boolean-typed filter anywhere in the codebase (every other Studio DB filter
  // in this app is a string/uuid) and went through studio-client.ts's `String(value)` query-param
  // coercion untested — a likely source of silently-empty lead lists whenever "verified only" was
  // checked. Fetching everything for the user and filtering here is provably correct instead.
  const candidates = await studioListSorted<Lead>(
    "leads",
    { filter: { userId }, cap: 5000 },
    compareLeadsForDisplay
  );

  const matched = candidates.map(normalizeStudioSourceType).filter(predicate);
  const capped = list.filterDefinition.maxLeads ? matched.slice(0, list.filterDefinition.maxLeads) : matched;
  const start = (page - 1) * size;
  const rows = capped.slice(start, start + size);

  return { list, leads: rows, page, pageSize: size, total: capped.length };
}
