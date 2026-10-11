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
  resolveSnapshotAccountAmounts,
} from "@/lib/pure/portfolio";

describe("buildPrevInactiveKeys", () => {
  it("collects keys for inactive accounts", () => {
    const prevAccounts = [
      {
        performanceAccountId: 1,
        taxType: "traditional",
        subType: null,
        ownerPersonId: null,
        isActive: false,
      },
      {
        performanceAccountId: 2,
        taxType: "roth",
        subType: null,
        ownerPersonId: null,
        isActive: true,
      },
      {
        performanceAccountId: 3,
        taxType: "traditional",
        subType: "espp",
        ownerPersonId: 7,
        isActive: false,
      },
    ];
    const keys = buildPrevInactiveKeys(prevAccounts);
    expect(keys.size).toBe(2);
    expect(keys.has("1_traditional__")).toBe(true);
    expect(keys.has("3_traditional_espp_7")).toBe(true);
    expect(keys.has("2_roth__")).toBe(false);
  });

  it("returns empty set when all active", () => {
    const keys = buildPrevInactiveKeys([
      {
        performanceAccountId: 1,
        taxType: "roth",
        subType: null,
        ownerPersonId: null,
        isActive: true,
      },
    ]);
    expect(keys.size).toBe(0);
  });
});

describe("snapshotAccountKey", () => {
  it("builds key with all fields, owner included", () => {
    expect(
      snapshotAccountKey({
        performanceAccountId: 5,
        taxType: "traditional",
        subType: "401k",
        ownerPersonId: 2,
      }),
    ).toBe("5_traditional_401k_2");
  });

  it("handles null performanceAccountId and a joint owner", () => {
    expect(
      snapshotAccountKey({
        performanceAccountId: null,
        taxType: "roth",
        subType: null,
        ownerPersonId: null,
      }),
    ).toBe("_roth__");
  });
});

describe("resolveAccountActiveStatus", () => {
  const inactiveKeys = new Set(["1_traditional__", "3_roth_espp_"]);

  it("returns false for previously inactive account", () => {
    expect(
      resolveAccountActiveStatus(
        {
          performanceAccountId: 1,
          taxType: "traditional",
          subType: null,
          ownerPersonId: null,
        },
        inactiveKeys,
      ),
    ).toBe(false);
  });

  it("returns true for account not in inactive set", () => {
    expect(
      resolveAccountActiveStatus(
        {
          performanceAccountId: 2,
          taxType: "roth",
          subType: null,
          ownerPersonId: null,
        },
        inactiveKeys,
      ),
    ).toBe(true);
  });

  it("returns true when inactive keys are empty", () => {
    expect(
      resolveAccountActiveStatus(
        {
          performanceAccountId: 1,
          taxType: "traditional",
          subType: null,
          ownerPersonId: null,
        },
        new Set(),
      ),
    ).toBe(true);
  });

  it("deactivating one person's sub-account in a joint account leaves the other's active", () => {
    // Joint IRA: Alice's Roth was deactivated, Bob's Roth was not.
    const keys = buildPrevInactiveKeys([
      {
        performanceAccountId: 9,
        taxType: "taxFree",
        subType: null,
        ownerPersonId: 1,
        isActive: false,
      },
      {
        performanceAccountId: 9,
        taxType: "taxFree",
        subType: null,
        ownerPersonId: 2,
        isActive: true,
      },
    ]);
    expect(
      resolveAccountActiveStatus(
        {
          performanceAccountId: 9,
          taxType: "taxFree",
          subType: null,
          ownerPersonId: 2,
        },
        keys,
      ),
    ).toBe(true);
    expect(
      resolveAccountActiveStatus(
        {
          performanceAccountId: 9,
          taxType: "taxFree",
          subType: null,
          ownerPersonId: 1,
        },
        keys,
      ),
    ).toBe(false);
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

describe("resolveSnapshotAccountAmounts", () => {
  const activeMasterIds = new Set([1, 2]);

  it("zeroes the amount for a closed-master account", () => {
    const accounts = [
      { performanceAccountId: 3, amount: "5000.25" },
      { performanceAccountId: 1, amount: "10000" },
    ];
    const result = resolveSnapshotAccountAmounts(accounts, activeMasterIds);
    expect(result[0]).toEqual({ performanceAccountId: 3, amount: "0" });
    expect(result[1]).toEqual({ performanceAccountId: 1, amount: "10000" });
  });

  it("leaves an open-master account's amount unchanged", () => {
    const accounts = [{ performanceAccountId: 2, amount: "20000" }];
    expect(resolveSnapshotAccountAmounts(accounts, activeMasterIds)).toEqual([
      { performanceAccountId: 2, amount: "20000" },
    ]);
  });

  it("leaves an unlinked (null performanceAccountId) account unchanged", () => {
    const accounts = [{ performanceAccountId: null, amount: "3000" }];
    expect(resolveSnapshotAccountAmounts(accounts, activeMasterIds)).toEqual([
      { performanceAccountId: null, amount: "3000" },
    ]);
  });

  it("does not mutate the input array", () => {
    const accounts = [{ performanceAccountId: 3, amount: "5000" }];
    const result = resolveSnapshotAccountAmounts(accounts, activeMasterIds);
    expect(result).not.toBe(accounts);
    expect(accounts[0]!.amount).toBe("5000");
  });
});
