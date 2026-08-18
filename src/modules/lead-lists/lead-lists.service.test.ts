import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead, LeadList } from "../../db/schema.js";
import { NotFoundError } from "../../lib/errors.js";
import { deleteLeadList, evaluateLeadList, getLeadList, listLeadLists, updateLeadList } from "./lead-lists.service.js";

// Compensating control for the lack of database-level tenant isolation (see
// accounts.service.test.ts for the full rationale) — this file covers lead-lists.service.ts's own
// ownership check, including the read-time filter evaluation path.

const studioGet = vi.fn();
const studioListSorted = vi.fn();
const studioInsert = vi.fn();
const studioUpdate = vi.fn();
const studioDelete = vi.fn();

vi.mock("../../db/studio-client.js", () => ({
  studioGet: (...args: unknown[]) => studioGet(...args),
  studioListSorted: (...args: unknown[]) => studioListSorted(...args),
  studioInsert: (...args: unknown[]) => studioInsert(...args),
  studioUpdate: (...args: unknown[]) => studioUpdate(...args),
  studioDelete: (...args: unknown[]) => studioDelete(...args),
}));

const OWNER = "owner-user-id";
const ATTACKER = "attacker-user-id";
const LIST_ID = "list-1";

const ownedList: LeadList = {
  id: LIST_ID,
  userId: OWNER,
  name: "My list",
  filterDefinition: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  studioListSorted.mockResolvedValue([]);
});

describe("lead-lists.service ownership isolation", () => {
  it("getLeadList: owner can read their own list", async () => {
    studioGet.mockResolvedValue(ownedList);
    const result = await getLeadList(OWNER, LIST_ID);
    expect(result.id).toBe(LIST_ID);
  });

  it("getLeadList: a different user gets NotFoundError instead of the row", async () => {
    studioGet.mockResolvedValue(ownedList);
    await expect(getLeadList(ATTACKER, LIST_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateLeadList: a different user cannot update someone else's list", async () => {
    studioGet.mockResolvedValue(ownedList);
    await expect(updateLeadList(ATTACKER, LIST_ID, { name: "renamed" })).rejects.toBeInstanceOf(NotFoundError);
    expect(studioUpdate).not.toHaveBeenCalled();
  });

  it("deleteLeadList: a different user cannot delete someone else's list", async () => {
    studioGet.mockResolvedValue(ownedList);
    await expect(deleteLeadList(ATTACKER, LIST_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(studioDelete).not.toHaveBeenCalled();
  });

  it("evaluateLeadList: a different user cannot evaluate someone else's list (and never fetches its leads)", async () => {
    studioGet.mockResolvedValue(ownedList);
    await expect(evaluateLeadList(ATTACKER, LIST_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(studioListSorted).not.toHaveBeenCalled();
  });
});

describe("static lead lists", () => {
  const makeLead = (id: string): Lead => ({
    id,
    userId: OWNER,
    handle: id,
    displayName: id,
    bio: null,
    followers: 100,
    location: null,
    verified: false,
    profileImage: null,
    sourceType: "search",
    sourceRef: "keyword",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
  });

  it("evaluates an explicitly selected set without including other owned leads", async () => {
    studioGet.mockResolvedValue({ ...ownedList, filterDefinition: { leadIds: ["selected"] } });
    studioListSorted.mockResolvedValue([makeLead("selected"), makeLead("not-selected")]);

    const result = await evaluateLeadList(OWNER, LIST_ID);

    expect(result.leads.map((lead) => lead.id)).toEqual(["selected"]);
  });
});

describe("internal scrape result stores", () => {
  it("never exposes hidden scrape result records in the user's lead list index", async () => {
    studioListSorted.mockResolvedValue([
      ownedList,
      {
        ...ownedList,
        id: "internal-result",
        name: "__talonr_scrape__job-1",
        filterDefinition: { internalScrapeResult: true, scrapeJobId: "job-1", leadIds: [] },
      },
    ]);

    const result = await listLeadLists(OWNER);

    expect(result).toEqual([ownedList]);
  });
});
