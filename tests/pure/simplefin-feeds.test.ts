/** Which feeds count, and the daily live estimate. Invented figures only. */
import { describe, it, expect } from "vitest";
import {
  countsAsFeed,
  dailyEstimates,
  liveCoversAccount,
} from "@/lib/pure/simplefin-feeds";

describe("countsAsFeed", () => {
  it("needs both a link and the checkbox", () => {
    expect(
      countsAsFeed({ linkedPerformanceAccountId: 1, isIncluded: true }),
    ).toBe(true);
    expect(
      countsAsFeed({ linkedPerformanceAccountId: 1, isIncluded: false }),
    ).toBe(false);
    expect(
      countsAsFeed({ linkedPerformanceAccountId: null, isIncluded: true }),
    ).toBe(false);
  });
});

describe("liveCoversAccount", () => {
  it("covers an account linked whole, or with every part linked, and nothing unplaced", () => {
    expect(liveCoversAccount(["a", "b"], [null], 0)).toBe(true);
    expect(liveCoversAccount(["a", "b"], ["a", "b"], 0)).toBe(true);
    expect(liveCoversAccount(["a", "b"], ["a"], 0)).toBe(false);
    expect(liveCoversAccount(["a"], ["a", null], 1)).toBe(false);
    expect(liveCoversAccount([], [null], 0)).toBe(false);
  });
});

describe("dailyEstimates", () => {
  it("adds each covered account's move from its snapshot amount, once its feeds report", () => {
    const points = dailyEstimates(["2026-10-11", "2026-10-12"], 1000, [
      { snapshotAmount: 500, feedHistories: [[["2026-10-11", 510]]] },
      // A second feed that only reports from the 12th.
      {
        snapshotAmount: 300,
        feedHistories: [[["2026-10-12", 280]], [["2026-10-01", 20]]],
      },
    ]);
    expect(points).toEqual([
      { date: "2026-10-11", total: 1010, accounts: 1 },
      { date: "2026-10-12", total: 1010, accounts: 2 },
    ]);
  });
});
