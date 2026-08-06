/**
 * Pure aggregation logic for the dashboard's "Linked Balance" card:
 * account-type breakdown (with nested tax type) and drift summary.
 * Value assertions, not just "runs without throwing" — these are
 * financial-summing functions.
 */
import { describe, it, expect } from "vitest";
import {
  summarizeByAccountType,
  summarizeDrift,
  type SimplefinAccountListItem,
} from "@/components/cards/dashboard/linked-balance-card";

function account(
  overrides: Partial<SimplefinAccountListItem> = {},
): SimplefinAccountListItem {
  return {
    id: 1,
    isIncluded: true,
    lastBalance: 0,
    linkedPerformanceAccountId: null,
    change: null,
    taxType: null,
    accountType: null,
    subType: null,
    snapshotDate: null,
    ...overrides,
  };
}

describe("summarizeByAccountType", () => {
  it("buckets included accounts by account type and sums to the total", () => {
    const accounts = [
      account({ id: 1, lastBalance: 100, accountType: "401k" }),
      account({ id: 2, lastBalance: 50, accountType: "401k" }),
      account({ id: 3, lastBalance: 200, accountType: "brokerage" }),
      account({ id: 4, lastBalance: 25, accountType: null }),
    ];
    const result = summarizeByAccountType(accounts);
    const total = result.reduce((s, r) => s + r.balance, 0);
    expect(total).toBe(375);

    const k401 = result.find((r) => r.label === "401k");
    expect(k401?.balance).toBe(150);
    const brokerage = result.find((r) => r.label === "Brokerage");
    expect(brokerage?.balance).toBe(200);
    const unmatched = result.find((r) => r.label === "Not matched");
    expect(unmatched?.balance).toBe(25);
  });

  it("keeps 'Not matched' last regardless of its balance size", () => {
    const accounts = [
      account({ id: 1, lastBalance: 5, accountType: "hsa" }),
      account({ id: 2, lastBalance: 999999, accountType: null }),
    ];
    const result = summarizeByAccountType(accounts);
    expect(result[result.length - 1]!.label).toBe("Not matched");
  });

  it("sorts matched groups largest balance first", () => {
    const accounts = [
      account({ id: 1, lastBalance: 100, accountType: "hsa" }),
      account({ id: 2, lastBalance: 500, accountType: "ira" }),
      account({ id: 3, lastBalance: 300, accountType: "401k" }),
    ];
    const result = summarizeByAccountType(accounts);
    expect(result.map((r) => r.label)).toEqual(["IRA", "401k", "HSA"]);
  });

  it("excludes accounts where isIncluded is false", () => {
    const accounts = [
      account({ lastBalance: 100, accountType: "brokerage" }),
      account({
        lastBalance: 999,
        accountType: "brokerage",
        isIncluded: false,
      }),
    ];
    const result = summarizeByAccountType(accounts);
    expect(result).toHaveLength(1);
    expect(result[0]!.balance).toBe(100);
  });

  it("returns an empty array when there are no included accounts", () => {
    expect(summarizeByAccountType([])).toEqual([]);
  });

  it("computes a per-group drift, deduped by performanceAccountId within the group", () => {
    const accounts = [
      account({
        id: 1,
        lastBalance: 100,
        accountType: "ira",
        linkedPerformanceAccountId: 10,
        change: 15,
      }),
      account({
        id: 2,
        lastBalance: 50,
        accountType: "ira",
        linkedPerformanceAccountId: 10, // same target — shouldn't double the drift
        change: 15,
      }),
      account({
        id: 3,
        lastBalance: 200,
        accountType: "ira",
        linkedPerformanceAccountId: 20,
        change: -5,
      }),
      account({
        id: 4,
        lastBalance: 30,
        accountType: "hsa",
      }), // unmatched — drift stays 0
    ];
    const result = summarizeByAccountType(accounts);
    expect(result.find((r) => r.label === "IRA")?.drift).toBe(10); // 15 + -5
    expect(result.find((r) => r.label === "HSA")?.drift).toBe(0);
  });
});

describe("summarizeDrift", () => {
  it("dedupes by linkedPerformanceAccountId so a shared change isn't double-counted", () => {
    const accounts = [
      account({ id: 1, linkedPerformanceAccountId: 10, change: 25 }),
      account({ id: 2, linkedPerformanceAccountId: 10, change: 25 }), // same group, same change
      account({ id: 3, linkedPerformanceAccountId: 20, change: -10 }),
      account({ id: 4, linkedPerformanceAccountId: 30, change: 0 }),
      account({ id: 5, linkedPerformanceAccountId: null, change: null }),
    ];
    const result = summarizeDrift(accounts);
    expect(result.groupCount).toBe(3);
    expect(result.driftedCount).toBe(2); // group 30 has change=0, not drifted
    expect(result.totalDrift).toBe(15); // 25 + -10 + 0
  });

  it("returns zeroed summary when nothing is matched", () => {
    expect(summarizeDrift([account(), account()])).toEqual({
      groupCount: 0,
      driftedCount: 0,
      totalDrift: 0,
    });
  });
});
