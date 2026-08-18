import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "../../db/schema.js";
import { NotFoundError } from "../../lib/errors.js";
import { compareLeadsForDisplay, deleteLead, deleteLeads, getLead, listLeads, upsertLeads } from "./leads.service.js";

// Compensating control for the lack of database-level tenant isolation (see
// accounts.service.test.ts for the full rationale) — this file covers leads.service.ts's own
// ownership check.

const studioGet = vi.fn();
const studioList = vi.fn();
const studioInsert = vi.fn();
const studioUpdate = vi.fn();
const studioDelete = vi.fn();

vi.mock("../../db/studio-client.js", () => ({
  studioGet: (...args: unknown[]) => studioGet(...args),
  studioList: (...args: unknown[]) => studioList(...args),
  studioListSorted: (...args: unknown[]) => studioList(...args),
  studioInsert: (...args: unknown[]) => studioInsert(...args),
  studioUpdate: (...args: unknown[]) => studioUpdate(...args),
  studioDelete: (...args: unknown[]) => studioDelete(...args),
}));

const OWNER = "owner-user-id";
const ATTACKER = "attacker-user-id";
const LEAD_ID = "lead-1";

const ownedLead: Lead = {
  id: LEAD_ID,
  userId: OWNER,
  handle: "someonesomewhere",
  displayName: "Someone",
  bio: null,
  followers: null,
  location: null,
  verified: false,
  profileImage: null,
  sourceType: "search",
  sourceRef: "keyword",
  firstSeenAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("leads.service ownership isolation", () => {
  it("getLead: owner can read their own lead", async () => {
    studioGet.mockResolvedValue(ownedLead);
    const result = await getLead(OWNER, LEAD_ID);
    expect(result.id).toBe(LEAD_ID);
  });

  it("getLead: a different user gets NotFoundError instead of the row", async () => {
    studioGet.mockResolvedValue(ownedLead);
    await expect(getLead(ATTACKER, LEAD_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("getLead: a nonexistent id gets NotFoundError, not a crash", async () => {
    studioGet.mockResolvedValue(null);
    await expect(getLead(OWNER, "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deleteLead: owner can delete their own lead", async () => {
    studioGet.mockResolvedValue(ownedLead);
    await deleteLead(OWNER, LEAD_ID);
    expect(studioDelete).toHaveBeenCalledWith("leads", LEAD_ID);
  });

  it("deleteLead: a different user cannot delete someone else's lead", async () => {
    studioGet.mockResolvedValue(ownedLead);
    await expect(deleteLead(ATTACKER, LEAD_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(studioDelete).not.toHaveBeenCalled();
  });

  it("deleteLeads: checks ownership of every id before bulk deletion", async () => {
    studioGet.mockResolvedValue(ownedLead);
    await expect(deleteLeads(ATTACKER, [LEAD_ID])).rejects.toBeInstanceOf(NotFoundError);
    expect(studioDelete).not.toHaveBeenCalled();
  });

  it("deleteLeads: deletes each unique owned lead", async () => {
    studioGet.mockResolvedValue(ownedLead);
    await expect(deleteLeads(OWNER, [LEAD_ID, LEAD_ID])).resolves.toBe(1);
    expect(studioDelete).toHaveBeenCalledTimes(1);
  });
});

describe("listLeads optional profile filters", () => {
  const matchingLead: Lead = {
    ...ownedLead,
    id: "lead-matching",
    handle: "accrafounder",
    followers: 2_500,
    location: "Accra, Ghana",
  };
  const tooSmall: Lead = {
    ...ownedLead,
    id: "lead-too-small",
    handle: "smallaccount",
    followers: 50,
    location: "Accra, Ghana",
  };
  const wrongLocation: Lead = {
    ...ownedLead,
    id: "lead-wrong-location",
    handle: "londonfounder",
    followers: 3_000,
    location: "London, UK",
  };
  const unknownFollowers: Lead = {
    ...ownedLead,
    id: "lead-unknown-followers",
    handle: "unknownaccount",
    followers: null,
    location: "Accra, Ghana",
  };

  it("filters by follower range and case-insensitive location before pagination", async () => {
    studioList.mockResolvedValue([matchingLead, tooSmall, wrongLocation, unknownFollowers]);

    const result = await listLeads(OWNER, {
      minFollowers: 1_000,
      maxFollowers: 5_000,
      location: "ghana",
      page: 1,
      pageSize: 50,
    });

    expect(result.leads).toEqual([matchingLead]);
  });

  it("keeps every lead when the optional filters are omitted", async () => {
    studioList.mockResolvedValue([matchingLead, tooSmall, wrongLocation, unknownFollowers]);

    const result = await listLeads(OWNER, { page: 1, pageSize: 50 });

    expect(result.leads).toHaveLength(4);
  });

  it("reports the full matched total, not the page length", async () => {
    studioList.mockResolvedValue([matchingLead, tooSmall, wrongLocation, unknownFollowers]);

    const result = await listLeads(OWNER, { page: 1, pageSize: 2 });

    expect(result.leads).toHaveLength(2);
    expect(result.total).toBe(4);
  });
});

describe("compareLeadsForDisplay", () => {
  // The Studio API has no ORDER BY, so studioListSorted pages an unordered relation and sorts in
  // Node. Leads written by one scrape share a lastSeenAt, so without a total order those ties
  // resolved differently per request and paging skipped/repeated leads.
  const sameSecond = (id: string): Lead => ({ ...ownedLead, id, lastSeenAt: "2026-01-01T00:00:00.000Z" });

  it("orders newest-seen first", () => {
    const older: Lead = { ...ownedLead, id: "a", lastSeenAt: "2026-01-01T00:00:00.000Z" };
    const newer: Lead = { ...ownedLead, id: "b", lastSeenAt: "2026-02-01T00:00:00.000Z" };
    expect([older, newer].sort(compareLeadsForDisplay).map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("breaks lastSeenAt ties deterministically regardless of arrival order", () => {
    const arrivalA = [sameSecond("c"), sameSecond("a"), sameSecond("b")];
    const arrivalB = [sameSecond("b"), sameSecond("c"), sameSecond("a")];

    expect(arrivalA.sort(compareLeadsForDisplay).map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(arrivalB.sort(compareLeadsForDisplay).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
});

describe("upsertLeads profile-data preservation", () => {
  it("does not overwrite a known follower count when enrichment came back empty", async () => {
    // Profile enrichment is best-effort. Writing its nulls over an already-enriched row erased
    // follower counts and locations, dropping the lead out of every follower-range filter.
    const existing: Lead = { ...ownedLead, followers: 5_000, location: "Accra, Ghana", bio: "founder" };
    studioList.mockResolvedValue({ rows: [existing] });
    studioUpdate.mockResolvedValue(existing);

    await upsertLeads(OWNER, "search", "keyword", [
      {
        handle: existing.handle,
        displayName: null,
        bio: null,
        followers: null,
        location: null,
        verified: false,
        profileImage: null,
      },
    ]);

    expect(studioUpdate).toHaveBeenCalledWith(
      "leads",
      existing.id,
      expect.objectContaining({ followers: 5_000, location: "Accra, Ghana", bio: "founder" })
    );
  });

  it("still applies freshly scraped profile data over the stored values", async () => {
    const existing: Lead = { ...ownedLead, followers: 5_000, location: "Accra, Ghana" };
    studioList.mockResolvedValue({ rows: [existing] });
    studioUpdate.mockResolvedValue(existing);

    await upsertLeads(OWNER, "search", "keyword", [
      {
        handle: existing.handle,
        displayName: "Someone Else",
        bio: "new bio",
        followers: 6_100,
        location: "London, UK",
        verified: true,
        profileImage: null,
      },
    ]);

    expect(studioUpdate).toHaveBeenCalledWith(
      "leads",
      existing.id,
      expect.objectContaining({ followers: 6_100, location: "London, UK", bio: "new bio", verified: true })
    );
  });
});
