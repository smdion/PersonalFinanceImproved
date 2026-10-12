/** One account's Portfolio-card insight. Invented figures only. */
import { describe, it, expect } from "vitest";
import { accountInsight, type InsightInput } from "@/lib/pure/account-insights";

const base = (over: Partial<InsightInput> = {}): InsightInput => ({
  performanceAccountId: 1,
  feeds: [
    {
      id: 10,
      subKey: null,
      balance: 1200,
      balanceDay: "2026-10-09",
      name: "Example Bank IRA",
    },
  ],
  parts: [{ key: "p1", label: "Alex — Roth", amount: 1000 }],
  unplaced: [],
  snapshotDate: "2026-10-01",
  snapshotCovered: true,
  depositsSince: "2026-07-01",
  sendsTransactions: true,
  transactions: [
    {
      posted: "2026-10-05",
      kind: "contribution",
      amount: 150,
      pending: false,
      uncertain: false,
      voided: false,
    },
    {
      posted: "2026-10-06",
      kind: "transfer",
      amount: 20,
      pending: false,
      uncertain: false,
      voided: false,
    },
  ],
  holdings: [],
  costHoldings: [],
  expectedYearly: null,
  storedCostBasis: null,
  ...over,
});

describe("accountInsight", () => {
  it("splits the change since the snapshot into added, moved and markets", () => {
    const r = accountInsight(base());
    expect(r.status).toBe("linked");
    expect(r.live).toEqual({ total: 1200, asOf: "2026-10-09" });
    expect(r.sinceSnapshot).toMatchObject({
      change: 200,
      added: 150,
      moved: 20,
      markets: 30,
    });
  });

  it("isn't comparable when part of the account isn't linked", () => {
    const r = accountInsight(
      base({
        feeds: [
          {
            id: 10,
            subKey: "p1",
            balance: 1200,
            balanceDay: null,
            name: "Example Bank IRA",
          },
        ],
        parts: [
          { key: "p1", label: "Alex — Roth", amount: 1000 },
          { key: "p2", label: "Sam — Roth", amount: 500 },
        ],
      }),
    );
    expect(r.sinceSnapshot).toBeNull();
    expect(r.unlinkedParts).toEqual(["Sam — Roth"]);
  });

  it("calls a feed with no recent transactions balance-only, and no feed none", () => {
    expect(accountInsight(base({ sendsTransactions: false })).status).toBe(
      "balance_only",
    );
    const none = accountInsight(base({ feeds: [] }));
    expect(none.status).toBe("none");
    expect(none.live).toBeNull();
  });

  it("names money no part holds by its feed", () => {
    const r = accountInsight(
      base({
        unplaced: [
          {
            feedId: 10,
            performanceAccountId: 1,
            balance: 50,
            reason: "no_part",
          },
        ],
      }),
    );
    expect(r.unplaced).toEqual([
      { name: "Example Bank IRA", balance: 50, reason: "no_part" },
    ]);
    expect(r.sinceSnapshot).toBeNull();
  });
});
