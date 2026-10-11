/** Yearly benchmark comparison. Invented numbers only. */
import { describe, it, expect } from "vitest";
import {
  indexYearReturn,
  simulateIndex,
  windowReturn,
  yearlyReturn,
  type YearlyResult,
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

describe("indexYearReturn", () => {
  it("gives a full year's index return for that year's money", () => {
    const r = indexYearReturn(
      year({ year: 2020 }),
      steadyPrices(2020, 12, 0.01),
    )!;
    expect(r.months).toBe(12);
    expect(r.returnPct).toBeCloseTo(1.01 ** 12 - 1, 4);
  });

  it("spreads a year-to-date year's money over the priced months only", () => {
    // 9 priced months, flat index, $900 deposited so far: no gain at all.
    const r = indexYearReturn(
      year({ year: 2020, begin: 0, contributions: 900, end: 900 }),
      steadyPrices(2020, 9, 0),
    )!;
    expect(r.months).toBe(9);
    expect(r.returnPct).toBeCloseTo(0, 6);
  });

  it("has nothing to say without prices for the year", () => {
    expect(
      indexYearReturn(year({ year: 2030 }), steadyPrices(2020, 12, 0.01)),
    ).toBeNull();
  });
});
