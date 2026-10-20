import { describe, it, expect } from "vitest";
import {
  resolveContributionProfileId,
  resolveContributionProfileIdsForAllColumns,
  resolveSalaryProfileId,
  resolveSalaryProfileIdsForAllColumns,
  type ColumnProfileResolutionInput,
} from "@/lib/calculators/contribution-profile-resolution";

/** Every tier explicitly "pins nothing" unless a test says otherwise. */
const base: ColumnProfileResolutionInput = {
  columnPinIds: null,
  numColumns: 3,
  column: 0,
  localSelectionId: null,
  globalDefaultId: null,
};

describe("resolveContributionProfileId", () => {
  it("returns the per-column override when one is set", () => {
    expect(
      resolveContributionProfileId({
        ...base,
        columnPinIds: [null, 7, null],
        column: 1,
        globalDefaultId: 2,
      }),
    ).toBe(7);
  });

  it("falls back to the global active profile when the column has no override", () => {
    expect(
      resolveContributionProfileId({
        ...base,
        columnPinIds: [null, null, null],
        column: 1,
        globalDefaultId: 2,
      }),
    ).toBe(2);
  });

  it("returns null when nothing at any tier resolves", () => {
    expect(
      resolveContributionProfileId({
        ...base,
        columnPinIds: [null, null, null],
        column: 1,
      }),
    ).toBeNull();
  });

  it("falls back to the global default when the column array is null", () => {
    expect(resolveContributionProfileId({ ...base, globalDefaultId: 5 })).toBe(
      5,
    );
  });

  it("falls back to the global default when the column array is undefined", () => {
    expect(
      resolveContributionProfileId({
        ...base,
        columnPinIds: undefined,
        globalDefaultId: 5,
      }),
    ).toBe(5);
  });

  it("treats a length-mismatched override array as no overrides at all, not a misaligned index", () => {
    // Array has 2 entries but there are 3 columns — a stale/mismatched
    // shape. Column 0's own entry (7) must NOT be used; every column
    // should fall through to the global default instead.
    expect(
      resolveContributionProfileId({
        ...base,
        columnPinIds: [7, null],
        globalDefaultId: 2,
      }),
    ).toBe(2);
  });
});

describe("documented precedence: column → local selection → active", () => {
  it("a column's own profile beats a local page selection", () => {
    expect(
      resolveContributionProfileId({
        columnPinIds: [7, null, null],
        numColumns: 3,
        column: 0,
        localSelectionId: 99,
        globalDefaultId: 2,
      }),
    ).toBe(7);
  });

  it("salary axis: a column's own profile beats a local page selection", () => {
    expect(
      resolveSalaryProfileId({
        columnPinIds: [null, 8],
        numColumns: 2,
        column: 1,
        localSelectionId: 99,
        globalDefaultId: 2,
      }),
    ).toBe(8);
  });

  it("local page selection beats the global default on an unpinned column", () => {
    expect(
      resolveContributionProfileId({
        columnPinIds: [7, null, null],
        numColumns: 3,
        column: 1,
        localSelectionId: 99,
        globalDefaultId: 2,
      }),
    ).toBe(99);
  });
});

describe("resolveContributionProfileIdsForAllColumns", () => {
  it("resolves every column independently", () => {
    expect(
      resolveContributionProfileIdsForAllColumns({
        columnPinIds: [null, 7, null],
        numColumns: 3,
        localSelectionId: null,
        globalDefaultId: 2,
      }),
    ).toEqual([2, 7, 2]);
  });

  it("returns an all-default array when the override array is null", () => {
    expect(
      resolveContributionProfileIdsForAllColumns({
        columnPinIds: null,
        numColumns: 3,
        localSelectionId: null,
        globalDefaultId: 9,
      }),
    ).toEqual([9, 9, 9]);
  });

  it("returns an empty array for zero columns", () => {
    expect(
      resolveContributionProfileIdsForAllColumns({
        columnPinIds: [1, 2],
        numColumns: 0,
        localSelectionId: null,
        globalDefaultId: 9,
      }),
    ).toEqual([]);
  });

  it("salary axis resolves every column independently too", () => {
    expect(
      resolveSalaryProfileIdsForAllColumns({
        columnPinIds: [null, 8],
        numColumns: 2,
        localSelectionId: null,
        globalDefaultId: 3,
      }),
    ).toEqual([3, 8]);
  });
});
