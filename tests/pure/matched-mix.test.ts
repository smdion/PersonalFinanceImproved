import { describe, it, expect } from "vitest";
import { matchedMixLevels, type MatchedMixInput } from "@/lib/pure/matched-mix";
import type { CompositionBucket } from "@/lib/config/enum-values";
import type { EffectiveFacts } from "@/lib/pure/fund-facts";

const facts = (
  buckets: Partial<Record<CompositionBucket, number>>,
): EffectiveFacts => ({
  expenseRatio: null,
  composition: {
    buckets: {
      us_equity: 0,
      intl_equity: 0,
      us_bond: 0,
      intl_bond: 0,
      tips: 0,
      cash: 0,
      other: 0,
      ...buckets,
    },
    coverage: 1,
    asOf: "2026-01-01",
    fromUser: false,
  },
  stale: false,
});
// Stocks +1%/month, bonds flat (fictional prices).
const series = (start: number, growth: number) => {
  const m = new Map<string, number>();
  let p = start;
  m.set("2019-12", p);
  for (let y = 2020; y <= 2021; y++)
    for (let mo = 1; mo <= 12; mo++) {
      p *= 1 + growth;
      m.set(`${y}-${String(mo).padStart(2, "0")}`, p);
    }
  return m;
};
const proxyPrices = {
  us_equity: series(100, 0.01),
  intl_equity: null,
  us_bond: series(50, 0),
  intl_bond: null,
  tips: null,
  cash: null,
  other: null,
} as MatchedMixInput["proxyPrices"];

const base: MatchedMixInput = {
  years: [2020, 2021],
  accountValues: new Map([
    [2020, new Map([[1, 1000]])],
    [2021, new Map([[1, 1000]])],
  ]),
  periods: [
    {
      id: 1,
      performanceAccountId: 1,
      subKey: null,
      start: "2020-01-01",
      end: null,
      basis: "user",
      weights: { 10: 0.5, 20: 0.5 },
    },
  ],
  observedDaily: new Map(),
  splits: new Map(),
  observedDailyByPart: new Map(),
  partSnapshots: new Map(),
  facts: new Map([
    [10, facts({ us_equity: 1 })],
    [20, facts({ us_bond: 1 })],
  ]),
  proxyPrices,
};

describe("matchedMixLevels", () => {
  it("50/50 stocks/bonds earns half the stock proxy's return each month, from 100", () => {
    const r = matchedMixLevels(base);
    expect(r.firstMonth).toBe("2020-01");
    expect(r.prices.get("2019-12")).toBe(100);
    expect(r.prices.get("2020-01")).toBeCloseTo(100.5, 9);
    expect(r.prices.get("2021-12")).toBeCloseTo(100 * 1.005 ** 24, 6);
    expect(r.excludedShare).toBe(0);
  });

  it("observed days override the entered period for their month", () => {
    const r = matchedMixLevels({
      ...base,
      observedDaily: new Map([
        [1, [{ day: "2020-03-02", weights: { 10: 1 } }]],
      ]),
    });
    const feb = r.prices.get("2020-02")!;
    expect(r.prices.get("2020-03")! / feb).toBeCloseTo(1.01, 9);
  });

  it("an uncovered account stops the run; coverage below the floor doesn't count", () => {
    const twoAccounts = matchedMixLevels({
      ...base,
      accountValues: new Map([
        [
          2020,
          new Map([
            [1, 1000],
            [2, 500],
          ]),
        ],
      ]),
    });
    expect(twoAccounts.firstMonth).toBeNull();
    const mostlyUnknown = matchedMixLevels({
      ...base,
      facts: new Map([[10, facts({ us_equity: 1 })]]), // fund 20 has no facts → 50% left out
    });
    expect(mostlyUnknown.firstMonth).toBeNull();
  });

  it("reports the share left out when under the floor's complement", () => {
    const r = matchedMixLevels({
      ...base,
      periods: [
        { ...base.periods[0]!, weights: { 10: 0.8, 20: 0.1, 30: 0.1 } },
      ],
    });
    expect(r.excludedShare).toBeCloseTo(0.1, 9);
  });

  describe("an account kept per part (one feed per person)", () => {
    // Account 1 split into two parts: A holds the stock fund, B the bond
    // fund; the snapshot puts 75% of the money in A.
    const A = "1_taxFree__1";
    const B = "1_taxFree__2";
    const split: MatchedMixInput = {
      ...base,
      periods: [
        { ...base.periods[0]!, subKey: A, weights: { 10: 1 } },
        { ...base.periods[0]!, id: 2, subKey: B, weights: { 20: 1 } },
      ],
      splits: new Map([[1, { conflict: false }]]),
      partSnapshots: new Map([
        [
          1,
          [
            {
              date: "2019-06-01",
              amounts: new Map([
                [A, 750],
                [B, 250],
              ]),
            },
          ],
        ],
      ]),
    };

    it("combines the parts' entered periods by their snapshot shares", () => {
      const r = matchedMixLevels(split);
      expect(r.prices.get("2020-01")).toBeCloseTo(100 * 1.0075, 9);
    });

    it("a whole-account period doesn't count for a split account", () => {
      const r = matchedMixLevels({
        ...split,
        periods: [{ ...base.periods[0]!, subKey: null }],
      });
      expect(r.firstMonth).toBeNull();
    });

    it("a part with money and no history leaves the month uncovered", () => {
      const r = matchedMixLevels({ ...split, periods: [split.periods[0]!] });
      expect(r.firstMonth).toBeNull();
    });

    it("one part observed, the other entered: still weighted by the snapshot shares", () => {
      const r = matchedMixLevels({
        ...split,
        // Pooled daily weights would say 100% part A's fund.
        observedDaily: new Map([
          [1, [{ day: "2020-03-02", weights: { 10: 1 } }]],
        ]),
        observedDailyByPart: new Map([
          [`1|${A}`, [{ day: "2020-03-02", weights: { 10: 1 } }]],
        ]),
      });
      const feb = r.prices.get("2020-02")!;
      expect(r.prices.get("2020-03")! / feb).toBeCloseTo(1.0075, 9);
    });

    it("every part observed that month: the account's pooled daily mix", () => {
      const r = matchedMixLevels({
        ...split,
        observedDaily: new Map([
          [1, [{ day: "2020-03-02", weights: { 10: 0.5, 20: 0.5 } }]],
        ]),
        observedDailyByPart: new Map([
          [`1|${A}`, [{ day: "2020-03-02", weights: { 10: 1 } }]],
          [`1|${B}`, [{ day: "2020-03-02", weights: { 20: 1 } }]],
        ]),
      });
      const feb = r.prices.get("2020-02")!;
      expect(r.prices.get("2020-03")! / feb).toBeCloseTo(1.005, 9);
    });

    it("parts first observed on different days of a month: weighted by snapshot shares, not the pooled first day", () => {
      const r = matchedMixLevels({
        ...split,
        // The pooled first day (Mar 2) has only part A's holdings.
        observedDaily: new Map<
          number,
          { day: string; weights: Record<number, number> }[]
        >([
          [
            1,
            [
              { day: "2020-03-02", weights: { 10: 1 } },
              { day: "2020-03-16", weights: { 10: 0.75, 20: 0.25 } },
            ],
          ],
        ]),
        observedDailyByPart: new Map([
          [`1|${A}`, [{ day: "2020-03-02", weights: { 10: 1 } }]],
          [`1|${B}`, [{ day: "2020-03-16", weights: { 20: 1 } }]],
        ]),
      });
      const feb = r.prices.get("2020-02")!;
      expect(r.prices.get("2020-03")! / feb).toBeCloseTo(1.0075, 9);
    });

    it("a conflict (part and whole-account feeds) isn't guessed", () => {
      const r = matchedMixLevels({
        ...split,
        splits: new Map([[1, { conflict: true }]]),
      });
      expect(r.firstMonth).toBeNull();
    });
  });
});
