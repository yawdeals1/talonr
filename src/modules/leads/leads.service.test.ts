import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "../../db/schema.js";
import { NotFoundError } from "../../lib/errors.js";
import { getLead } from "./leads.service.js";

// Compensating control for the lack of database-level tenant isolation (see
// accounts.service.test.ts for the full rationale) — this file covers leads.service.ts's own
// ownership check.

const studioGet = vi.fn();
const studioList = vi.fn();
const studioInsert = vi.fn();
const studioUpdate = vi.fn();

vi.mock("../../db/studio-client.js", () => ({
  studioGet: (...args: unknown[]) => studioGet(...args),
  studioList: (...args: unknown[]) => studioList(...args),
  studioListSorted: (...args: unknown[]) => studioList(...args),
  studioInsert: (...args: unknown[]) => studioInsert(...args),
  studioUpdate: (...args: unknown[]) => studioUpdate(...args),
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
});
