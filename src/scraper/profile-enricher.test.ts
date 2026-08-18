import { describe, expect, it } from "vitest";
import { parseFollowerCount, pickFollowerCount } from "./profile-enricher.js";

describe("parseFollowerCount", () => {
  it.each([
    ["1,234 Followers", 1234],
    ["12.5K Followers", 12_500],
    ["3M Followers", 3_000_000],
    ["1.2B Followers", 1_200_000_000],
    [" 987 ", 987],
  ])("parses %s", (value, expected) => {
    expect(parseFollowerCount(value)).toBe(expected);
  });

  it("returns null for missing or non-numeric labels", () => {
    expect(parseFollowerCount(null)).toBeNull();
    expect(parseFollowerCount("Followers")).toBeNull();
  });
});

describe("pickFollowerCount", () => {
  it("prefers the exact aria-label over the rounded link text", () => {
    // X renders both on the same anchor. Reading the rounded one made follower-range filters
    // compare against a bucket instead of the real count.
    expect(pickFollowerCount("6,412,338 Followers", "6.4M Followers")).toBe(6_412_338);
    expect(pickFollowerCount("1,249 Followers", "1.2K Followers")).toBe(1_249);
  });

  it("keeps a sub-threshold account below a round bound it would otherwise clear", () => {
    // 999 followers renders as "1K", which used to store as 1000 and pass a minFollowers: 1000
    // filter it should have failed.
    expect(pickFollowerCount("999 Followers", "999 Followers")).toBe(999);
    expect(pickFollowerCount(null, "1K Followers")).toBe(1_000);
  });

  it("falls back to whichever candidate parses", () => {
    expect(pickFollowerCount(null, "342 Followers")).toBe(342);
    expect(pickFollowerCount("Followers", "342 Followers")).toBe(342);
    expect(pickFollowerCount(null, null)).toBeNull();
    expect(pickFollowerCount("Followers", null)).toBeNull();
  });
});
