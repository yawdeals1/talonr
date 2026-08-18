import { describe, expect, it } from "vitest";
import { parseFollowerCount } from "./profile-enricher.js";

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
