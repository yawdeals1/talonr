import { studioDelete, studioGet, studioInsert, studioListSorted, studioUpdate } from "../../db/studio-client.js";
import type { FilterDefinition, Lead, LeadList } from "../../db/schema.js";
import { NotFoundError } from "../../lib/errors.js";
import { buildFilterPredicate } from "./filter-query-builder.js";

const byCreatedAtDesc = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt);

export async function listLeadLists(userId: string) {
  return studioListSorted<LeadList>("lead_lists", { filter: { userId } }, byCreatedAtDesc);
}

async function findOwnedOrThrow(userId: string, id: string): Promise<LeadList> {
  const list = await studioGet<LeadList>("lead_lists", id);
  if (!list || list.userId !== userId) throw new NotFoundError("Lead list not found");
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
    (a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)
  );

  const matched = candidates.filter(predicate);
  const capped = list.filterDefinition.maxLeads ? matched.slice(0, list.filterDefinition.maxLeads) : matched;
  const start = (page - 1) * size;
  const rows = capped.slice(start, start + size);

  return { list, leads: rows, page, pageSize: size };
}
