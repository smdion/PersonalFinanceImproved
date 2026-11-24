import { describe, expect, it } from "vitest";
import {
  conversionTaxCost,
  conversionTaxPaid,
} from "@/lib/pure/engine/conversion-tax";
import { TEST_BRACKETS } from "../fixtures/engine-fixtures";

const tables = { taxBrackets: TEST_BRACKETS, taxMultiplier: 1 };
const paidFor = (
  income: number,
  conversion: number,
  cash: number,
  t: Parameters<typeof conversionTaxPaid>[3] = tables,
) => conversionTaxPaid(income, conversion, cash, t);

/** The paid conversion is the largest whole cent: its tax fits the cash and
 *  one cent more doesn't (or the conversion is whole). */
function expectLargest(
  income: number,
  conversion: number,
  cash: number,
  t: Parameters<typeof conversionTaxPaid>[3] = tables,
) {
  const r = paidFor(income, conversion, cash, t);
  expect(r.tax).toBeLessThanOrEqual(cash);
  expect(r.tax).toBe(conversionTaxCost(income, r.conversion, t));
  const oneCentMore = Math.round(r.conversion * 100 + 1) / 100;
  if (oneCentMore <= conversion)
    expect(conversionTaxCost(income, oneCentMore, t)).toBeGreaterThan(cash);
  return r;
}

describe("conversionTaxPaid (CV1)", () => {
  it("keeps the whole conversion and its tax when the cash covers it", () => {
    const tax = conversionTaxCost(50_000, 10_000, tables);
    expect(paidFor(50_000, 10_000, tax)).toEqual({
      conversion: 10_000,
      tax,
    });
  });

  it("is the largest cent whose rounded tax the cash pays, in the band the year sits in", () => {
    // Income 50,000 sits in the 12% band (tax without 3,670.50): $1 pays
    // 0.12 × c rounded to ≤ 1.00, so c < 1.005 ÷ 0.12 = 8.375: 8.37
    // (1.0044 → 1.00); 8.38 costs 1.0056 → 1.01.
    expect(paidFor(50_000, 46_175, 1)).toEqual({ conversion: 8.37, tax: 1 });
  });

  it("with no cash, converts only what its rounded tax leaves at 0", () => {
    // 12%: 0.04 costs 0.0048 → 0.00; 0.05 costs 0.006 → 0.01.
    expect(paidFor(50_000, 46_175, 0)).toEqual({ conversion: 0.04, tax: 0 });
    // Income 10,000: the 6,550 up to 16,550 is untaxed, then 10%.
    const r = expectLargest(10_000, 100_000, 0);
    expect(r.conversion).toBeGreaterThanOrEqual(6_550);
    expect(r.conversion).toBeLessThan(6_550.06);
  });

  it("solves across bands: the 0% band, then 10%", () => {
    const r = expectLargest(10_000, 100_000, 500);
    expect(r.conversion).toBeGreaterThanOrEqual(11_550);
    expect(r.conversion).toBeLessThan(11_550.06);
  });

  it("never exceeds the conversion it shrinks", () => {
    expect(paidFor(50_000, 5, 1_000).conversion).toBe(5);
  });

  it("scales by the tax multiplier", () => {
    // 1.5 × 12%: 18¢ a dollar over a tax without of 5,505.75; $9 pays
    // c < 9.005 ÷ 0.18 = 50.027…: 50.02 (9.0036 → 9.00).
    const t = { ...tables, taxMultiplier: 1.5 };
    expect(paidFor(50_000, 46_175, 9, t)).toEqual({
      conversion: 50.02,
      tax: 9,
    });
  });

  it("keeps the effective-rate ceiling's tax as the engine prices it", () => {
    // A multiplier of 10 pushes the schedule past MAX_EFFECTIVE_TAX_RATE
    // (50%): every converted dollar costs 50¢, so $100 pays $200 (and a
    // cent more only where its half cent rounds down).
    const t = { ...tables, taxMultiplier: 10 };
    const r = expectLargest(50_000, 46_175, 100, t);
    expect(r.tax).toBe(100);
    expect(r.conversion).toBeGreaterThanOrEqual(200);
    expect(r.conversion).toBeLessThanOrEqual(200.01);
  });

  it("is the largest payable cent for any start, cash and multiplier", () => {
    for (const taxMultiplier of [1, 0.02, 1.37]) {
      const t = { ...tables, taxMultiplier };
      for (const income of [0, 12_345.67, 33_725, 96_174.99, 250_000]) {
        for (const cash of [0, 0.01, 1, 333.33, 12_000]) {
          expectLargest(income, 500_000, cash, t);
        }
      }
    }
  });
});
