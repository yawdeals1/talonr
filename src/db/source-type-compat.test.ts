import { describe, expect, it } from "vitest";
import { fromStudioSourceType, normalizeStudioSourceType, toStudioSourceType } from "./source-type-compat.js";

describe("Studio source type compatibility", () => {
  it("stores engagers under the retired likers enum value", () => {
    expect(toStudioSourceType("engagers")).toBe("likers");
  });

  it("presents the storage alias as engagers", () => {
    expect(fromStudioSourceType("likers")).toBe("engagers");
    expect(normalizeStudioSourceType({ id: "job-1", sourceType: "likers" })).toEqual({
      id: "job-1",
      sourceType: "engagers",
    });
  });

  it("leaves unaffected source types unchanged", () => {
    expect(toStudioSourceType("search")).toBe("search");
    expect(fromStudioSourceType("followers")).toBe("followers");
  });
});
