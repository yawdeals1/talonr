import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "../../db/schema.js";
import { NotFoundError } from "../../lib/errors.js";
import { deleteLead, getLead, listLeads } from "./leads.service.js";

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
});
