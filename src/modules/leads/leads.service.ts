import { studioDelete, studioGet, studioInsert, studioList, studioListSorted, studioUpdate } from "../../db/studio-client.js";
import { normalizeStudioSourceType, toStudioSourceType } from "../../db/source-type-compat.js";
import type { Lead, SourceType } from "../../db/schema.js";
import { mapWithConcurrency } from "../../lib/concurrency.js";
import { NotFoundError } from "../../lib/errors.js";
import type { RawLead } from "../../scraper/types.js";
import { buildFilterPredicate } from "../lead-lists/filter-query-builder.js";

export interface ListLeadsOptions {
  handle?: string;
  sourceType?: SourceType;
  sourceRef?: string;
  minFollowers?: number;
  maxFollowers?: number;
  location?: string;
  page?: number;
  pageSize?: number;
}

const UPSERT_CONCURRENCY = 8;

/**
 * No bulk upsert endpoint on the Studio API — each lead is a GET (existence check by the
 * user_id+handle unique key) followed by a POST or PATCH, run with bounded concurrency. This is
 * meaningfully slower than the single `INSERT ... ON CONFLICT` this replaced, but scrape volume is
 * deliberately capped (SCRAPE_CAP_LEADS_DEFAULT) for a personal-scale project.
 */
export async function upsertLeads(
  userId: string,
  sourceType: "search" | "followers" | "engagers",
  sourceRef: string,
  rawLeads: RawLead[]
): Promise<Lead[]> {
  if (rawLeads.length === 0) return [];

  return mapWithConcurrency(rawLeads, UPSERT_CONCURRENCY, async (lead) => {
    const { rows } = await studioList<Lead>("leads", { filter: { userId, handle: lead.handle }, limit: 1 });
    const fields = {
      displayName: lead.displayName,
      bio: lead.bio,
      followers: lead.followers,
      location: lead.location,
      verified: lead.verified,
      profileImage: lead.profileImage,
      sourceType: toStudioSourceType(sourceType),
      sourceRef,
    };

    if (rows[0]) {
      return studioUpdate<Lead>("leads", rows[0].id, { ...fields, lastSeenAt: new Date() });
    } else {
      // firstSeenAt/lastSeenAt omitted — the column defaults (NOW()) apply on insert.
      return studioInsert<Lead>("leads", { userId, handle: lead.handle, ...fields });
    }
  });

}

export async function listLeads(userId: string, options: ListLeadsOptions) {
  const page = options.page ?? 1;
  const pageSize = Math.min(options.pageSize ?? 50, 200);

  // sourceType/sourceRef push down as equality filters; handle is a substring search, which the
  // Studio API can't do server-side (no ORDER BY either) — fetch the (already-narrowed) set and
  // filter/sort/paginate in-process.
  const all = await studioListSorted<Lead>(
    "leads",
    {
      filter: {
        userId,
        ...(options.sourceType ? { sourceType: toStudioSourceType(options.sourceType) } : {}),
        ...(options.sourceRef ? { sourceRef: options.sourceRef } : {}),
      },
      cap: 5000,
    },
    (a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)
  );

  const predicate = buildFilterPredicate({
    minFollowers: options.minFollowers,
    maxFollowers: options.maxFollowers,
    location: options.location,
  });
  const handleNeedle = options.handle?.toLowerCase();
  const filtered = all
    .map(normalizeStudioSourceType)
    .filter((lead) => (!handleNeedle || lead.handle.toLowerCase().includes(handleNeedle)) && predicate(lead));

  const start = (page - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);

  return { leads: rows, page, pageSize };
}

export async function getLead(userId: string, leadId: string) {
  const lead = await studioGet<Lead>("leads", leadId);
  if (!lead || lead.userId !== userId) throw new NotFoundError("Lead not found");
  return normalizeStudioSourceType(lead);
}

export async function deleteLead(userId: string, leadId: string): Promise<void> {
  await getLead(userId, leadId);
  await studioDelete("leads", leadId);
}

export async function deleteLeads(userId: string, leadIds: string[]): Promise<number> {
  const uniqueIds = [...new Set(leadIds)];
  // Finish every ownership check before deleting anything so a foreign id cannot cause a
  // partially-applied request.
  await mapWithConcurrency(uniqueIds, UPSERT_CONCURRENCY, (leadId) => getLead(userId, leadId));
  await mapWithConcurrency(uniqueIds, UPSERT_CONCURRENCY, (leadId) => studioDelete("leads", leadId));
  return uniqueIds.length;
}
