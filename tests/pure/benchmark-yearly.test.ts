/** Yearly benchmark comparison. Invented numbers only. */
import { describe, it, expect } from "vitest";
import {
  simulateIndex,
  windowReturn,
  yearlyReturn,
  type YearlyResult,
  firstRealYear,
  runBenchmark,
  yearlyResultsFrom,
  yourWindowMonths,
  type PerformanceYearRow,
} from "@/lib/pure/benchmark-yearly";

/** Prices growing a steady `monthly` rate from Dec of `fromYear - 1`. */
function steadyPrices(fromYear: number, months: number, monthly: number) {
  const m = new Map<string, number>();
  let p = 100;
  m.set(`${fromYear - 1}-12`, p);
  for (let i = 0; i < months; i++) {
    p *= 1 + monthly;
    const y = fromYear + Math.floor(i / 12);
    m.set(`${y}-${String((i % 12) + 1).padStart(2, "0")}`, p);
  }
  return m;
}

const year = (
  over: Partial<YearlyResult> & { year: number },
): YearlyResult => ({
  begin: 1000,
  contributions: 0,
  outflows: 0,
  gain: 0,
  end: 1000,
  ...over,
});

describe("simulateIndex", () => {
  it("with no deposits, grows exactly with the index", () => {
    const [y] = simulateIndex(
      [year({ year: 2020 })],
      steadyPrices(2020, 12, 0.01),
    )!;
    expect(y!.end).toBeCloseTo(1000 * 1.01 ** 12, 2);
    expect(y!.returnPct).toBeCloseTo(1.01 ** 12 - 1, 4);
  });

  it("puts each year's deposits in across its months", () => {
    const [y] = simulateIndex(
      [year({ year: 2020, begin: 0, contributions: 1200, end: 1200 })],
      steadyPrices(2020, 12, 0),
    )!;
    expect(y!.end).toBeCloseTo(1200, 2); // flat index → just the deposits
  });

  it("carries money that appears between years (rollovers) into the index", () => {
    const run = simulateIndex(
      [
        year({ year: 2020, end: 1000 }),
        year({ year: 2021, begin: 1500, end: 1500 }),
      ],
      steadyPrices(2020, 24, 0),
    )!;
    expect(run[1]!.begin).toBeCloseTo(1500, 2);
  });

  it("stops at the first unpriced month and marks the year partial", () => {
    const run = simulateIndex(
      [year({ year: 2020 }), year({ year: 2021 })],
      steadyPrices(2020, 15, 0.01),
    )!;
    expect(run.map((r) => r.months)).toEqual([12, 3]);
  });

  it("can't start without a price for the month before", () => {
    expect(simulateIndex([year({ year: 2020 })], new Map())).toBeNull();
  });
});

describe("returns", () => {
  it("your yearly return matches the Performance page formula", () => {
    // gain 100 on 1000 + half of 200 deposited → 100 / 1100
    expect(
      yearlyReturn(
        year({ year: 2020, contributions: 200, gain: 100, end: 1300 }),
      ),
    ).toBeCloseTo(100 / 1100, 6);
  });

  it("annualizes a multi-year window and not a short one", () => {
    const two = windowReturn(
      [year({ year: 2020 }), year({ year: 2021 })],
      1000 * 1.1 ** 2,
      24,
    )!;
    expect(two.annualized).toBe(true);
    expect(two.value).toBeCloseTo(0.1, 3);
    const short = windowReturn([year({ year: 2020 })], 1050, 6)!;
    expect(short.annualized).toBe(false);
    expect(short.value).toBeCloseTo(0.05, 3);
  });
});

describe("comparison building blocks", () => {
  const row = (year: number, over: Partial<PerformanceYearRow> = {}) => ({
    year,
    beginningBalance: 1000,
    totalContributions: 100,
    rollovers: 0,
    distributions: 0,
    fees: 0,
    yearlyGainLoss: 50,
    endingBalance: 1150,
    ...over,
  });

  it("yearlyResultsFrom sums accounts per year, oldest first; rollovers in, fees and distributions out", () => {
    const ys = yearlyResultsFrom([
      row(2021),
      row(2020, { rollovers: 25, fees: 5, distributions: 10 }),
      row(2020),
    ]);
    expect(ys.map((y) => y.year)).toEqual([2020, 2021]);
    expect(ys[0]).toEqual({
      year: 2020,
      begin: 2000,
      contributions: 225,
      outflows: 15,
      gain: 100,
      end: 2300,
    });
  });

  it("firstRealYear skips leading flat placeholder years", () => {
    const ys = yearlyResultsFrom([row(2019, { yearlyGainLoss: 0 }), row(2020)]);
    expect(firstRealYear(ys)).toBe(2020);
    expect(firstRealYear([])).toBeNull();
  });

  it("runBenchmark: no prices → not available", () => {
    expect(runBenchmark(yearlyResultsFrom([row(2020)]), null)).toEqual({
      available: false,
      years: [],
      window: null,
    });
  });

  it("yourWindowMonths: the most any benchmark priced, else calendar months through today", () => {
    const ys = yearlyResultsFrom([row(2025), row(2026)]);
    expect(
      yourWindowMonths(
        ys,
        [[{ months: 12 } as never], []],
        new Date(2026, 5, 1),
      ),
    ).toBe(12);
    // 2025 full + 2026 through June (month index 5 → 12 − 7 = 5 months short)
    expect(yourWindowMonths(ys, [], new Date(2026, 5, 1))).toBe(24 - 7);
  });
});
