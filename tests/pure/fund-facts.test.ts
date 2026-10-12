/** Effective fund facts and portfolio roll-ups. Invented values only. */
import { describe, it, expect } from "vitest";
import {
  accountRollup,
  blendedCost,
  effectiveFacts,
  portfolioBuckets,
  type FactRow,
} from "@/lib/pure/fund-facts";

const comp = (over: Partial<Record<string, number>> = {}) => ({
  us_equity: 0,
  intl_equity: 0,
  us_bond: 0,
  intl_bond: 0,
  tips: 0,
  cash: 0,
  other: 0,
  coverage: 1,
  ...over,
});

const rows: FactRow[] = [
  {
    source: "sec_ncsr",
    asOf: "2025-11-28",
    expenseRatio: 0.0008,
    composition: null,
  },
  {
    source: "sec_ncsr",
    asOf: "2024-11-28",
    expenseRatio: 0.0009,
    composition: null,
  },
  {
    source: "sec_nport",
    asOf: "2026-06-30",
    expenseRatio: null,
    composition: comp({ us_equity: 0.6, intl_equity: 0.4 }),
  },
];

describe("effectiveFacts", () => {
  it("uses the latest SEC filing for each group", () => {
    const f = effectiveFacts(rows, "2026-10-11");
    expect(f.expenseRatio).toEqual({
      value: 0.0008,
      asOf: "2025-11-28",
      fromUser: false,
    });
    expect(f.composition?.buckets.us_equity).toBe(0.6);
    expect(f.stale).toBe(false);
  });
  it("prefers the household's own entry", () => {
    const f = effectiveFacts(
      [
        ...rows,
        {
          source: "user",
          asOf: "2026-01-01",
          expenseRatio: 0.002,
          composition: null,
        },
      ],
      "2026-10-11",
    );
    expect(f.expenseRatio).toMatchObject({ value: 0.002, fromUser: true });
    expect(f.composition?.fromUser).toBe(false);
  });
  it("flags SEC facts older than 15 months", () => {
    expect(effectiveFacts(rows, "2027-04-01").stale).toBe(true);
  });
});

describe("portfolio roll-ups", () => {
  const facts = (c: ReturnType<typeof comp> | null, er: number | null) => ({
    expenseRatio:
      er === null ? null : { value: er, asOf: "2026-01-01", fromUser: false },
    composition: c && {
      buckets: c,
      coverage: c.coverage,
      asOf: "2026-01-01",
      fromUser: false,
    },
    stale: false,
  });
  const holdings = [
    { value: 1000, facts: facts(comp({ us_equity: 1 }), 0.001) },
    { value: 1000, facts: facts(comp({ us_bond: 1, coverage: 0.5 }), null) },
    { value: 500, facts: facts(null, 0.005) },
  ];

  it("spreads value across buckets and keeps the unexplained part separate", () => {
    const r = portfolioBuckets(holdings);
    expect(r.buckets.us_equity).toBe(1000);
    expect(r.buckets.us_bond).toBe(500);
    expect(r.unknown).toBe(1000);
    expect(r.total).toBe(2500);
  });

  it("weights expense ratios by value and reports coverage", () => {
    const c = blendedCost(holdings);
    expect(c.yearlyCost).toBeCloseTo(1 + 2.5);
    expect(c.expenseRatio).toBeCloseTo(3.5 / 1500);
    expect(c.coveredShare).toBeCloseTo(0.6);
  });

  it("adds up an account's funds as shares of the money whose mix is known", () => {
    const r = accountRollup(holdings)!;
    expect(r.coverage).toBeCloseTo(1500 / 2500);
    expect(r.mix!.us_equity).toBeCloseTo(1000 / 1500);
    expect(r.mix!.us_bond).toBeCloseTo(500 / 1500);
    expect(r.cost.expenseRatio).toBeCloseTo(3.5 / 1500);
  });

  it("has no rollup for an account that effectively holds one fund", () => {
    const one = holdings[0]!;
    expect(accountRollup([one])).toBeNull();
    // Cash dust next to the fund doesn't make it a multi-fund account.
    expect(accountRollup([one, { ...one, value: 1 }])).toBeNull();
    expect(accountRollup([])).toBeNull();
  });

  it("still adds up an account whose funds' mixes are all unknown", () => {
    const r = accountRollup([holdings[2]!, holdings[2]!])!;
    expect(r.mix).toBeNull();
    expect(r.coverage).toBe(0);
    expect(r.cost.yearlyCost).toBeCloseTo(5);
  });
});
