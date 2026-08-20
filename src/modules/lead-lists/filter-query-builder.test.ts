import { describe, expect, it } from "vitest";
import type { Lead } from "../../db/schema.js";
import { buildFilterPredicate } from "./filter-query-builder.js";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    userId: "user-1",
    handle: "someone",
    displayName: "Someone",
    bio: "Building things",
    followers: 500,
    location: "Accra, Ghana",
    verified: false,
    profileImage: null,
    sourceType: "followers",
    sourceRef: "target",
    firstSeenAt: "2026-08-20T00:00:00.000Z",
    lastSeenAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildFilterPredicate follower bounds", () => {
  const inRange = buildFilterPredicate({ minFollowers: 100, maxFollowers: 2000 });

  it("keeps leads inside the range and drops leads outside it", () => {
    expect(inRange(lead({ followers: 500 }))).toBe(true);
    expect(inRange(lead({ followers: 100 }))).toBe(true);
    expect(inRange(lead({ followers: 2000 }))).toBe(true);
    expect(inRange(lead({ followers: 2 }))).toBe(false);
    expect(inRange(lead({ followers: 7536 }))).toBe(false);
  });

  it("drops leads whose follower count is unknown, however the row expresses it", () => {
    // The Studio DB is a REST API: a count can arrive as null, as a numeric string, or be missing
    // from the row entirely. `undefined` compares false against *both* bounds, so an un-enriched
    // lead used to satisfy a min and a max at once and show up in a range it never matched — the
    // 2-follower accounts that came back from a "100 to 2,000" scrape.
    expect(inRange(lead({ followers: null }))).toBe(false);
    expect(inRange({ ...lead(), followers: undefined as unknown as number })).toBe(false);
    expect(inRange({ ...lead(), followers: Number.NaN })).toBe(false);
    expect(inRange({ ...lead(), followers: "" as unknown as number })).toBe(false);
  });

  it("reads a numeric string count the same as a number", () => {
    expect(inRange({ ...lead(), followers: "500" as unknown as number })).toBe(true);
    expect(inRange({ ...lead(), followers: "5" as unknown as number })).toBe(false);
  });

  it("treats minFollowers 0 as no lower bound, including for unknown counts", () => {
    const noMinimum = buildFilterPredicate({ minFollowers: 0 });
    expect(noMinimum(lead({ followers: null }))).toBe(true);
    expect(noMinimum(lead({ followers: 1 }))).toBe(true);
  });
});

describe("buildFilterPredicate on raw (not yet saved) leads", () => {
  it("matches a mid-scrape lead that has no id yet", () => {
    const predicate = buildFilterPredicate({ minFollowers: 100, maxFollowers: 2000 });
    const rawLead = {
      handle: "someone",
      displayName: "Someone",
      bio: null,
      followers: 235,
      location: null,
      verified: false,
      profileImage: null,
    };
    expect(predicate(rawLead)).toBe(true);
    expect(predicate({ ...rawLead, followers: 1 })).toBe(false);
  });

  it("never matches a leadIds filter against a lead with no id", () => {
    const predicate = buildFilterPredicate({ leadIds: ["lead-1"] });
    expect(predicate(lead())).toBe(true);
    expect(predicate({ bio: null, followers: 1, location: null, verified: false })).toBe(false);
  });
});
