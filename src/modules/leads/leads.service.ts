import { studioGet, studioInsert, studioList, studioListSorted, studioUpdate } from "../../db/studio-client.js";
import type { Lead } from "../../db/schema.js";
import { mapWithConcurrency } from "../../lib/concurrency.js";
import { NotFoundError } from "../../lib/errors.js";
import type { RawLead } from "../../scraper/types.js";

export interface ListLeadsOptions {
  handle?: string;
  sourceType?: "search" | "followers" | "likers";
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
  sourceType: "search" | "followers" | "likers",
  sourceRef: string,
  rawLeads: RawLead[]
): Promise<number> {
  if (rawLeads.length === 0) return 0;

  await mapWithConcurrency(rawLeads, UPSERT_CONCURRENCY, async (lead) => {
    const { rows } = await studioList<Lead>("leads", { filter: { userId, handle: lead.handle }, limit: 1 });
    const fields = {
      displayName: lead.displayName,
      bio: lead.bio,
      followers: lead.followers,
      location: lead.location,
      verified: lead.verified,
      profileImage: lead.profileImage,
      sourceType,
      sourceRef,
    };

    if (rows[0]) {
      await studioUpdate<Lead>("leads", rows[0].id, { ...fields, lastSeenAt: new Date() });
    } else {
      // firstSeenAt/lastSeenAt omitted — the column defaults (NOW()) apply on insert.
      await studioInsert<Lead>("leads", { userId, handle: lead.handle, ...fields });
    }
  });

  return rawLeads.length;
}

export async function listLeads(userId: string, options: ListLeadsOptions) {
  const page = options.page ?? 1;
  const pageSize = Math.min(options.pageSize ?? 50, 200);

  // sourceType pushes down as an equality filter; handle is a substring search, which the Studio
  // API can't do server-side (no ORDER BY either) — fetch the (already-narrowed) set and
  // filter/sort/paginate in-process.
  const all = await studioListSorted<Lead>(
    "leads",
    { filter: { userId, ...(options.sourceType ? { sourceType: options.sourceType } : {}) }, cap: 5000 },
    (a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)
  );

  const filtered = options.handle
    ? all.filter((l) => l.handle.toLowerCase().includes(options.handle!.toLowerCase()))
    : all;

  const start = (page - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);

  return { leads: rows, page, pageSize };
}

export async function getLead(userId: string, leadId: string) {
  const lead = await studioGet<Lead>("leads", leadId);
  if (!lead || lead.userId !== userId) throw new NotFoundError("Lead not found");
  return lead;
}
