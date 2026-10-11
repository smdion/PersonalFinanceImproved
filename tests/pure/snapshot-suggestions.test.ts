/** Suggested snapshot balances from linked feeds. Invented figures only. */
import { describe, it, expect } from "vitest";
import { suggestSnapshotAmounts } from "@/lib/pure/snapshot-suggestions";

const subs = [
  { key: "roth", performanceAccountId: 1, amount: 300 },
  { key: "trad", performanceAccountId: 1, amount: 100 },
  { key: "solo", performanceAccountId: 2, amount: 50 },
  { key: "nofeed", performanceAccountId: 3, amount: 10 },
];

describe("suggestSnapshotAmounts", () => {
  it("uses a sub-account link's balance as is", () => {
    const s = suggestSnapshotAmounts(subs, [
      {
        performanceAccountId: 1,
        subKey: "roth",
        balance: 320,
        balanceDate: "2026-10-09",
      },
    ]);
    expect(s.get("roth")).toEqual({
      amount: 320,
      source: "linked",
      balanceDate: "2026-10-09",
    });
    expect(s.has("trad")).toBe(false);
  });

  it("splits a whole-account link by the last snapshot and says it's estimated", () => {
    const s = suggestSnapshotAmounts(subs, [
      {
        performanceAccountId: 1,
        subKey: null,
        balance: 800,
        balanceDate: null,
      },
      {
        performanceAccountId: 2,
        subKey: null,
        balance: 55.55,
        balanceDate: null,
      },
    ]);
    expect(s.get("roth")).toMatchObject({ amount: 600, source: "estimated" });
    expect(s.get("trad")).toMatchObject({ amount: 200, source: "estimated" });
    expect(s.get("solo")).toMatchObject({ amount: 55.55, source: "linked" });
    expect(s.has("nofeed")).toBe(false);
  });

  it("gives a whole-account link only the sub-accounts not linked on their own", () => {
    const s = suggestSnapshotAmounts(subs, [
      {
        performanceAccountId: 1,
        subKey: "roth",
        balance: 320,
        balanceDate: null,
      },
      { performanceAccountId: 1, subKey: null, balance: 90, balanceDate: null },
    ]);
    expect(s.get("roth")?.amount).toBe(320);
    expect(s.get("trad")).toMatchObject({ amount: 90, source: "linked" });
  });

  it("splits remainders so the parts add up to the balance", () => {
    const s = suggestSnapshotAmounts(
      [
        { key: "a", performanceAccountId: 1, amount: 1 },
        { key: "b", performanceAccountId: 1, amount: 1 },
        { key: "c", performanceAccountId: 1, amount: 1 },
      ],
      [
        {
          performanceAccountId: 1,
          subKey: null,
          balance: 100,
          balanceDate: null,
        },
      ],
    );
    const parts = ["a", "b", "c"].map((k) => s.get(k)!.amount);
    expect(parts.reduce((t, v) => t + v, 0)).toBeCloseTo(100, 10);
  });
});
