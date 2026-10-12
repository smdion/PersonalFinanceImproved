/** Snapshots as stacked by-account series. Invented figures only. */
import { describe, it, expect } from "vitest";
import {
  MAX_STACKED_ACCOUNTS,
  stackedSeries,
} from "@/lib/pure/snapshot-series";

const snap = (date: string, accounts: [string, number][]) => ({
  date,
  byAccount: accounts.map(([key, amount]) => ({
    key,
    label: key === "other" ? "Other" : `Account ${key}`,
    amount,
  })),
});

describe("stackedSeries", () => {
  it("stacks each account, largest first, with a row per snapshot", () => {
    const r = stackedSeries([
      snap("2026-01-01", [
        ["1", 100],
        ["2", 300],
      ]),
      snap("2026-02-01", [
        ["1", 150],
        ["2", 320],
        ["other", 5],
      ]),
    ]);
    expect(r.series.map((s) => s.key)).toEqual(["2", "1", "other"]);
    expect(r.rows).toEqual([
      { date: "2026-01-01", "2": 300, "1": 100, other: 0 },
      { date: "2026-02-01", "2": 320, "1": 150, other: 5 },
    ]);
  });

  it("folds accounts beyond the limit into Other, keeping the totals", () => {
    const many = Array.from(
      { length: MAX_STACKED_ACCOUNTS + 2 },
      (_, i) => [String(i + 1), (i + 1) * 10] as [string, number],
    );
    const r = stackedSeries([snap("2026-01-01", many)]);
    expect(r.series).toHaveLength(MAX_STACKED_ACCOUNTS + 1);
    expect(r.series.at(-1)!.key).toBe("other");
    const row = r.rows[0]!;
    const total = r.series.reduce((t, s) => t + (row[s.key] as number), 0);
    expect(total).toBe(many.reduce((t, [, v]) => t + v, 0));
    expect(row.other).toBe(10 + 20); // the two smallest
  });
});
