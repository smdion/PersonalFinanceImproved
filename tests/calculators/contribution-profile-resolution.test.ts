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
  planPinId: null,
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

// ---------------------------------------------------------------------------
// REGRESSION (pre-existing bug): documented precedence was implemented
// backwards.
//
// docs/RULES.md has always documented
//   Plan pin > per-budget-column pin > local page selection > globally-active
// but the shipped code resolved the Plan pin FIRST (via useEffectiveProfileId)
// and then handed that result into this resolver's LOWEST tier — so a budget
// column's own pin beat the active Plan's pin. On a household with an active
// Plan pinning Contribution Profile 42 and a budget column pinning profile 7,
// the Budget page showed column 7's contribution reality while every other
// page on the same Plan showed 42.
//
// Against the OLD signature these two cases were literally inexpressible (the
// Plan pin had no tier of its own); against the OLD behavior, with the Plan
// pin passed as the "active" argument, they returned the COLUMN pin (7 / 8).
// ---------------------------------------------------------------------------
describe("Plan pin beats a per-column pin (documented precedence)", () => {
  it("contribution axis: Plan pin wins over the column's own pin", () => {
    expect(
      resolveContributionProfileId({
        planPinId: 42,
        columnPinIds: [7, 7, 7],
        numColumns: 3,
        column: 1,
        localSelectionId: 99,
        globalDefaultId: 2,
      }),
    ).toBe(42);
  });

  it("salary axis: Plan pin wins over the column's own pin", () => {
    expect(
      resolveSalaryProfileId({
        planPinId: 43,
        columnPinIds: [8, 8],
        numColumns: 2,
        column: 0,
        localSelectionId: 99,
        globalDefaultId: 3,
      }),
    ).toBe(43);
  });

  it("every column resolves to the Plan pin when one is active", () => {
    expect(
      resolveContributionProfileIdsForAllColumns({
        planPinId: 42,
        columnPinIds: [7, null, 9],
        numColumns: 3,
        localSelectionId: null,
        globalDefaultId: 2,
      }),
    ).toEqual([42, 42, 42]);
  });

  it("column pin still beats a local page selection when no Plan pin is active", () => {
    expect(
      resolveContributionProfileId({
        planPinId: null,
        columnPinIds: [7, null, null],
        numColumns: 3,
        column: 0,
        localSelectionId: 99,
        globalDefaultId: 2,
      }),
    ).toBe(7);
  });

  it("local page selection beats the global default on an unpinned column", () => {
    expect(
      resolveContributionProfileId({
        planPinId: null,
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
        planPinId: null,
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
        planPinId: null,
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
        planPinId: null,
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
        planPinId: null,
        columnPinIds: [null, 8],
        numColumns: 2,
        localSelectionId: null,
        globalDefaultId: 3,
      }),
    ).toEqual([3, 8]);
  });
});
