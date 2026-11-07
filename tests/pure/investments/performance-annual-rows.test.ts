/**
 * The Performance summary's annual rows (lib/pure/investments/performance-
 * annual-rows.ts), on the invented household in
 * tests/helpers/performance-household.ts.
 */
import { describe, expect, it } from "vitest";
import {
  addRetirementRollup,
  performanceAnnualRows,
  performanceCategories,
  performanceLifetimeFlows,
} from "@/lib/pure/investments/performance-annual-rows";
import { household, perfLookups } from "../../helpers/performance-household";

function summarize() {
  const { accounts, annual } = household();
  const { currentYear, annualRows } = performanceAnnualRows(
    annual,
    accounts,
    perfLookups,
  );
  addRetirementRollup(annualRows, accounts, perfLookups, currentYear);
  return { accounts, currentYear, annualRows };
}

const row = (
  rows: ReturnType<typeof summarize>["annualRows"],
  year: number,
  category: string,
) => rows.find((r) => r.year === year && r.category === category);

describe("performance summary annual rows", () => {
  it("builds each category's row from the account rows, and Portfolio from the categories", () => {
    const { currentYear, annualRows, accounts } = summarize();
    expect(currentYear).toBeNull();
    expect(row(annualRows, 2025, "401k/IRA")?.endingBalance).toBe(1145);
    expect(row(annualRows, 2025, "Brokerage")?.endingBalance).toBe(715);
    const portfolio = row(annualRows, 2025, "Portfolio");
    expect(portfolio?.endingBalance).toBe(1860);
    expect(portfolio?.lifetimeGains).toBe(80);
    expect(portfolio?.lifetimeContributions).toBe(100);
    expect(portfolio?.lifetimeMatch).toBe(10);
    // The account rows' parentCategory comes from the master record.
    expect(accounts.map((a) => a.parentCategory)).toEqual([
      "Retirement",
      "Portfolio",
      "Retirement",
    ]);
  });

  it("rolls Retirement up from the 401k and the Retirement-goal brokerage account, dropping a stray stored Retirement row", () => {
    const { annualRows } = summarize();
    const retirement = row(annualRows, 2025, "Retirement");
    expect(retirement?.endingBalance).toBe(1355);
    expect(retirement?.yearlyGainLoss).toBe(60);
    expect(retirement?.lifetimeGains).toBe(60);
    expect(retirement?.lifetimeContributions).toBe(100);
    expect(retirement?.lifetimeMatch).toBe(10);
    expect(annualRows.some((r) => r.year === 2024)).toBe(false);
    expect(annualRows.map((r) => r.year)).toEqual(
      [...annualRows.map((r) => r.year)].sort((a, b) => a - b),
    );
  });

  it("lists the account-type categories, then the rollups", () => {
    const { annualRows } = summarize();
    expect(performanceCategories(annualRows)).toEqual({
      accountTypeCategories: ["401k/IRA", "Brokerage"],
      parentCategories: ["Retirement", "Portfolio"],
      categories: ["401k/IRA", "Brokerage", "Retirement", "Portfolio"],
    });
  });

  it("sums lifetime fees and distributions over the Portfolio rows", () => {
    const { annualRows } = summarize();
    expect(performanceLifetimeFlows(annualRows)).toEqual({
      lifetimeFees: 5,
      lifetimeDistributions: 15,
    });
  });
});
