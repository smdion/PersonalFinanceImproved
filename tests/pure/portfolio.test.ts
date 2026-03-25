/**
 * Tests for pure portfolio snapshot business logic.
 * Covers: buildPrevInactiveKeys, snapshotAccountKey, resolveAccountActiveStatus,
 * computeSnapshotEndingBalances, resolveSnapshotParentCategory.
 */
import { describe, it, expect } from "vitest";
import {
  buildPrevInactiveKeys,
  snapshotAccountKey,
  resolveAccountActiveStatus,
  computeSnapshotEndingBalances,
  resolveSnapshotParentCategory,
} from "@/lib/pure/portfolio";

describe("buildPrevInactiveKeys", () => {
  it("collects keys for inactive accounts", () => {
    const prevAccounts = [
      {
        performanceAccountId: 1,
        taxType: "traditional",
        subType: null,
        isActive: false,
      },
      {
        performanceAccountId: 2,
        taxType: "roth",
        subType: null,
        isActive: true,
      },
      {
        performanceAccountId: 3,
        taxType: "traditional",
        subType: "espp",
        isActive: false,
      },
    ];
    const keys = buildPrevInactiveKeys(prevAccounts);
    expect(keys.size).toBe(2);
    expect(keys.has("1_traditional_")).toBe(true);
    expect(keys.has("3_traditional_espp")).toBe(true);
    expect(keys.has("2_roth_")).toBe(false);
  });

  it("returns empty set when all active", () => {
    const keys = buildPrevInactiveKeys([
      {
        performanceAccountId: 1,
        taxType: "roth",
        subType: null,
        isActive: true,
      },
    ]);
    expect(keys.size).toBe(0);
  });
});

describe("snapshotAccountKey", () => {
  it("builds key with all fields", () => {
    expect(
      snapshotAccountKey({
        performanceAccountId: 5,
        taxType: "traditional",
        subType: "401k",
      }),
    ).toBe("5_traditional_401k");
  });

  it("handles null performanceAccountId", () => {
    expect(
      snapshotAccountKey({
        performanceAccountId: null,
        taxType: "roth",
        subType: null,
      }),
    ).toBe("_roth_");
  });
});

describe("resolveAccountActiveStatus", () => {
  const inactiveKeys = new Set(["1_traditional_", "3_roth_espp"]);

  it("returns false for previously inactive account", () => {
    expect(
      resolveAccountActiveStatus(
        { performanceAccountId: 1, taxType: "traditional", subType: null },
        inactiveKeys,
      ),
    ).toBe(false);
  });

  it("returns true for account not in inactive set", () => {
    expect(
      resolveAccountActiveStatus(
        { performanceAccountId: 2, taxType: "roth", subType: null },
        inactiveKeys,
      ),
    ).toBe(true);
  });

  it("returns true when inactive keys are empty", () => {
    expect(
      resolveAccountActiveStatus(
        { performanceAccountId: 1, taxType: "traditional", subType: null },
        new Set(),
      ),
    ).toBe(true);
  });
});

describe("computeSnapshotEndingBalances", () => {
  it("groups and sums by performanceAccountId", () => {
    const accounts = [
      { performanceAccountId: 1, amount: "10000.50" },
      { performanceAccountId: 1, amount: "5000.25" },
      { performanceAccountId: 2, amount: "20000" },
      { performanceAccountId: null, amount: "3000" }, // ignored
    ];
    const totals = computeSnapshotEndingBalances(accounts);
    expect(totals.get(1)).toBeCloseTo(15000.75);
    expect(totals.get(2)).toBe(20000);
    expect(totals.size).toBe(2); // null excluded
  });

  it("returns empty map for no accounts", () => {
    expect(computeSnapshotEndingBalances([]).size).toBe(0);
  });
});

describe("resolveSnapshotParentCategory", () => {
  const perfCatMap = new Map([
    [1, "Retirement"],
    [2, "Portfolio"],
  ]);

  it("uses master category when performanceAccountId is linked", () => {
    expect(resolveSnapshotParentCategory("Portfolio", 1, perfCatMap)).toBe(
      "Retirement",
    );
  });

  it("falls back to input when no performanceAccountId", () => {
    expect(resolveSnapshotParentCategory("Portfolio", null, perfCatMap)).toBe(
      "Portfolio",
    );
  });

  it("falls back to input when perfId not in map", () => {
    expect(resolveSnapshotParentCategory("Portfolio", 99, perfCatMap)).toBe(
      "Portfolio",
    );
  });
});
