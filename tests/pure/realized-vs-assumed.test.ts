/** Realized vs assumed returns. Invented figures only. */
import { describe, it, expect } from "vitest";
import {
  assumedRateAt,
  realizedVsAssumed,
} from "@/lib/pure/realized-vs-assumed";

const rates = [
  { age: 30, rate: 0.08 },
  { age: 40, rate: 0.07 },
  { age: 50, rate: 0.06 },
];

describe("assumedRateAt", () => {
  it("uses the highest age at or below, like the projection engine", () => {
    expect(assumedRateAt(rates, 39)).toBe(0.08);
    expect(assumedRateAt(rates, 40)).toBe(0.07);
    expect(assumedRateAt(rates, 25)).toBe(0.08); // below the table: lowest row
    expect(assumedRateAt([], 40)).toBeNull();
  });
});

describe("realizedVsAssumed", () => {
  it("pairs each completed year with the rate for the household's average age", () => {
    const r = realizedVsAssumed(
      [
        { year: 2018, returnPct: 0 }, // placeholder: doesn't start the comparison
        { year: 2019, returnPct: 0.1 },
        { year: 2020, returnPct: 0.2 },
        { year: 2021, returnPct: 0.05 }, // current year: left out
      ],
      [1980, 1982], // average age 38 in 2019, 39 in 2020
      rates,
      2021,
    );
    expect(r.rows).toEqual([
      { year: 2019, age: 38, realized: 0.1, assumed: 0.08 },
      { year: 2020, age: 39, realized: 0.2, assumed: 0.08 },
    ]);
    expect(r.realizedAnnual).toBeCloseTo(Math.sqrt(1.1 * 1.2) - 1, 6);
    expect(r.assumedAnnual).toBeCloseTo(0.08, 6);
  });

  it("is empty without people or a rate table", () => {
    expect(
      realizedVsAssumed([{ year: 2019, returnPct: 0.1 }], [], rates, 2021).rows,
    ).toEqual([]);
  });
});
