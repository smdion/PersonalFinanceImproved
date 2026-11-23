/**
 * A snapshot's money by tax type (lib/pure/net-worth/tax-location.ts), on
 * invented rows.
 */
import { describe, expect, it } from "vitest";
import {
  portfolioByTaxLocationFrom,
  portfolioByTaxTypeFrom,
} from "@/lib/pure/net-worth/tax-location";

const rows = [
  { parentCategory: "Retirement", taxType: "preTax", amount: "100.50" },
  { parentCategory: null, taxType: "preTax", amount: 50 },
  { parentCategory: "Portfolio", taxType: "taxFree", amount: "20" },
];

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
});

describe("portfolioByTaxTypeFrom", () => {
  it("sums by tax type, every parent together", () => {
    expect(portfolioByTaxTypeFrom(rows)).toEqual({
      preTax: 150.5,
      taxFree: 20,
    });
    expect(portfolioByTaxTypeFrom([])).toEqual({});
  });
});
