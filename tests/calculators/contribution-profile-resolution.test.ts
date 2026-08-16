import { describe, it, expect } from "vitest";
import {
  resolveContributionProfileId,
  resolveContributionProfileIdsForAllColumns,
} from "@/lib/calculators/contribution-profile-resolution";

describe("resolveContributionProfileId", () => {
  it("returns the per-column override when one is set", () => {
    expect(resolveContributionProfileId([null, 7, null], 1, 3, 2)).toBe(7);
  });

  it("falls back to the global active profile when the column has no override", () => {
    expect(resolveContributionProfileId([null, null, null], 1, 3, 2)).toBe(2);
  });

  it("falls back to Live (null) when there's no override and no global default", () => {
    expect(
      resolveContributionProfileId([null, null, null], 1, 3, null),
    ).toBeNull();
  });

  it("falls back to the global default when the column array is null", () => {
    expect(resolveContributionProfileId(null, 0, 3, 5)).toBe(5);
  });

  it("falls back to the global default when the column array is undefined", () => {
    expect(resolveContributionProfileId(undefined, 0, 3, 5)).toBe(5);
  });

  it("treats a length-mismatched override array as no overrides at all, not a misaligned index", () => {
    // Array has 2 entries but there are 3 columns — a stale/mismatched
    // shape. Column 0's own entry (7) must NOT be used; every column
    // should fall through to the global default instead.
    expect(resolveContributionProfileId([7, null], 0, 3, 2)).toBe(2);
  });
});

describe("resolveContributionProfileIdsForAllColumns", () => {
  it("resolves every column independently", () => {
    expect(
      resolveContributionProfileIdsForAllColumns([null, 7, null], 3, 2),
    ).toEqual([2, 7, 2]);
  });

  it("returns an all-default array when the override array is null", () => {
    expect(resolveContributionProfileIdsForAllColumns(null, 3, 9)).toEqual([
      9, 9, 9,
    ]);
  });

  it("returns an empty array for zero columns", () => {
    expect(resolveContributionProfileIdsForAllColumns([1, 2], 0, 9)).toEqual(
      [],
    );
  });
});
