import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { leads } from "../../db/schema.js";
import { NotFoundError } from "../../lib/errors.js";
import type { RawLead } from "../../scraper/types.js";

export interface ListLeadsOptions {
  handle?: string;
  sourceType?: "search" | "followers" | "likers";
  page?: number;
  pageSize?: number;
}

export async function upsertLeads(
  userId: string,
  sourceType: "search" | "followers" | "likers",
  sourceRef: string,
  rawLeads: RawLead[]
): Promise<number> {
  if (rawLeads.length === 0) return 0;

  const now = new Date();
  const values = rawLeads.map((lead) => ({
    userId,
    handle: lead.handle,
    displayName: lead.displayName,
    bio: lead.bio,
    followers: lead.followers,
    location: lead.location,
    verified: lead.verified,
    profileImage: lead.profileImage,
    sourceType,
    sourceRef,
    firstSeenAt: now,
    lastSeenAt: now,
  }));

  await db
    .insert(leads)
    .values(values)
    .onConflictDoUpdate({
      target: [leads.userId, leads.handle],
      set: {
        displayName: sql`excluded.display_name`,
        bio: sql`excluded.bio`,
        followers: sql`excluded.followers`,
        location: sql`excluded.location`,
        verified: sql`excluded.verified`,
        profileImage: sql`excluded.profile_image`,
        sourceType: sql`excluded.source_type`,
        sourceRef: sql`excluded.source_ref`,
        lastSeenAt: sql`excluded.last_seen_at`,
      },
    });
  return rawLeads.length;
}

export async function listLeads(userId: string, options: ListLeadsOptions) {
  const page = options.page ?? 1;
  const pageSize = Math.min(options.pageSize ?? 50, 200);

  const conditions = [eq(leads.userId, userId)];
  if (options.handle) conditions.push(ilike(leads.handle, `%${options.handle}%`));
  if (options.sourceType) conditions.push(eq(leads.sourceType, options.sourceType));

  const rows = await db.query.leads.findMany({
    where: and(...conditions),
    orderBy: desc(leads.lastSeenAt),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { leads: rows, page, pageSize };
}

export async function getLead(userId: string, leadId: string) {
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.userId, userId)),
  });
  if (!lead) throw new NotFoundError("Lead not found");
  return lead;
}
