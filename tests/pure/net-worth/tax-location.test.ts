/**
 * A snapshot's money by booked tax type (lib/pure/net-worth/tax-location.ts),
 * on invented rows.
 */
import { describe, expect, it } from "vitest";
import {
  portfolioByTaxLocationFrom,
  portfolioByTaxTypeFrom,
  withBookedTaxTypes,
} from "@/lib/pure/net-worth/tax-location";

const row = (
  parentCategory: string | null,
  taxType: string,
  amount: string | number,
  accountType = "401k",
  more: { subType?: string; performanceAccountId?: number } = {},
) => ({
  parentCategory,
  taxType,
  amount,
  accountType,
  subType: more.subType ?? null,
  performanceAccountId: more.performanceAccountId ?? null,
});

const rows = [
  row("Retirement", "preTax", "100.50"),
  row(null, "preTax", 50),
  row("Portfolio", "taxFree", "20", "ira"),
];

/** A 401(k) row saved after-tax, a Rollover row of an IRA's account saved
 *  after-tax, and a row of a type this version doesn't know. */
const mismatched = [
  row("Retirement", "afterTax", "70"),
  row("Retirement", "taxFree", "10", "ira", { performanceAccountId: 4 }),
  row("Retirement", "afterTax", "5", "401k", {
    subType: "Rollover",
    performanceAccountId: 4,
  }),
  row("Portfolio", "afterTax", "30", "inventedPlanType"),
];

describe("withBookedTaxTypes", () => {
  it("puts each row's booked tax type in place of its stored one, in order", () => {
    expect(withBookedTaxTypes(mismatched).map((r) => r.taxType)).toEqual([
      "preTax",
      "taxFree",
      "preTax",
      "afterTax",
    ]);
    expect(withBookedTaxTypes(rows)).toEqual(rows);
  });
});

describe("portfolioByTaxLocationFrom", () => {
  it("sums by tax type, Portfolio-parented apart from the rest", () => {
    expect(portfolioByTaxLocationFrom(rows)).toEqual({
      retirement: { preTax: 150.5 },
      portfolio: { taxFree: 20 },
    });
    expect(portfolioByTaxLocationFrom([])).toEqual({
      retirement: {},
      portfolio: {},
    });
  });

  it("sums each row by its booked tax type; an unknown account type's as stored", () => {
    expect(portfolioByTaxLocationFrom(mismatched)).toEqual({
      retirement: { preTax: 75, taxFree: 10 },
      portfolio: { afterTax: 30 },
    });
  });
});

describe("portfolioByTaxTypeFrom", () => {
  it("sums by tax type, every parent together", () => {
    expect(portfolioByTaxTypeFrom(rows)).toEqual({
      preTax: 150.5,
      taxFree: 20,
    });
    expect(portfolioByTaxTypeFrom([])).toEqual({});
  });

  it("sums each row by its booked tax type; an unknown account type's as stored", () => {
    expect(portfolioByTaxTypeFrom(mismatched)).toEqual({
      preTax: 75,
      taxFree: 10,
      afterTax: 30,
    });
  });
});
