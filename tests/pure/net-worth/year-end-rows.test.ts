/**
 * The year-end history's stored-year stages (lib/pure/net-worth/
 * year-end-rows.ts), on an invented household: a 401k and a brokerage
 * account, 2024 finalized, 2025 still open. buildYearEndHistory's full rows
 * stay pinned in tests/baseline (networth.*, historical.*, milestones.*).
 */
import { describe, expect, it } from "vitest";
import {
  homeFiguresByYear,
  mortgageBalanceByYearFrom,
  storedYearEndRows,
  yearEndPerformance,
  yearEndPerformanceSummary,
} from "@/lib/pure/net-worth/year-end-rows";

const masters = new Map([
  [1, { accountType: "401k", parentCategory: "Retirement" }],
  [2, { accountType: "brokerage", parentCategory: "Portfolio" }],
]);
const resolveHistoryMaster = (acct: { performanceAccountId: number | null }) =>
  masters.get(acct.performanceAccountId!)!;

const accountRow = (
  id: number,
  year: number,
  performanceAccountId: number,
  begin: number,
  gain: number,
  contribs = 0,
  employer = 0,
) => ({
  id,
  year,
  institution: "Acme",
  accountLabel: `Acct ${performanceAccountId} (Acme)`,
  performanceAccountId,
  beginningBalance: String(begin),
  totalContributions: String(contribs),
  yearlyGainLoss: String(gain),
  endingBalance: String(begin + gain + contribs + employer),
  employerContributions: String(employer),
  distributions: "0",
  fees: "0",
  rollovers: "0",
});

const accountPerfRows = [
  accountRow(1, 2024, 1, 900, 40, 50, 10),
  accountRow(2, 2024, 2, 480, 20),
  accountRow(3, 2025, 1, 1000, 100),
];

const annualRow = (
  year: number,
  category: string,
  endingBalance: string,
  annualReturnPct: string | null,
) => ({
  year,
  category,
  isFinalized: true,
  beginningBalance: "0",
  totalContributions: "0",
  employerContributions: "0",
  yearlyGainLoss: "0",
  endingBalance,
  distributions: "0",
  annualReturnPct,
});

const annualPerfRows = [
  annualRow(2024, "401k/IRA", "999", null),
  annualRow(2024, "Portfolio", "1500.5", "0.05"),
];

function performance() {
  const perf = yearEndPerformance(
    accountPerfRows,
    annualPerfRows,
    resolveHistoryMaster,
  );
  const summary = yearEndPerformanceSummary(
    accountPerfRows,
    annualPerfRows,
    perf.allPerfAccountYears,
    resolveHistoryMaster,
  );
  return { ...perf, ...summary };
}

describe("homeFiguresByYear", () => {
  it("accumulates home improvements through each year and sums property taxes", () => {
    const { homeImprovementsCumulativeByYear, propTaxByYear } =
      homeFiguresByYear(
        [
          { year: 2023, cost: "1000" },
          { year: 2025, cost: "500" },
        ],
        [{ yearEndDate: "2024-12-31" }],
        [
          { year: 2024, taxAmount: "100" },
          { year: 2024, taxAmount: "50" },
        ],
      );
    expect([...homeImprovementsCumulativeByYear]).toEqual([
      [2023, 1000],
      [2024, 1000],
      [2025, 1500],
    ]);
    expect(propTaxByYear.get(2024)).toBe(150);
  });
});

describe("yearEndPerformance", () => {
  it("totals the portfolio by account type and labels each account", () => {
    const { perfPortfolioByYear, perfByAccountByYear } = performance();
    expect(perfPortfolioByYear.get(2024)).toEqual({
      portfolioTotal: 1500,
      byType: { "401k": 1000, brokerage: 500 },
    });
    expect(perfByAccountByYear.get(2024)!.map((a) => a.label)).toEqual([
      "Acme — Acct 1",
      "Acme — Acct 2",
    ]);
  });

  it("takes a finalized year's categories from its annual rows, an open year's from its accounts", () => {
    const { perfByCategoryByYear } = performance();
    expect(Object.keys(perfByCategoryByYear.get(2024)!)).toEqual(["401k/IRA"]);
    expect(perfByCategoryByYear.get(2024)!["401k/IRA"]!.endingBalance).toBe(
      999,
    );
    expect(perfByCategoryByYear.get(2025)!["401k/IRA"]).toMatchObject({
      endingBalance: 1100,
      gainLoss: 100,
    });
  });

  it("groups by parent category and prefers the finalized Portfolio summary", () => {
    const { perfByParentCategoryByYear, perfSummaryByYear } = performance();
    expect(perfByParentCategoryByYear.get(2024)).toMatchObject({
      Retirement: { endingBalance: 1000, employerMatch: 10 },
      Portfolio: { endingBalance: 500 },
    });
    expect(perfSummaryByYear.get(2024)).toMatchObject({
      endingBalance: 1500.5,
      returnPct: 0.05,
    });
    expect(perfSummaryByYear.get(2025)).toMatchObject({
      beginningBalance: 1000,
      endingBalance: 1100,
    });
  });
});

describe("storedYearEndRows", () => {
  const nwRow = (yearEndDate: string) => ({
    yearEndDate,
    portfolioTotal: "1200",
    retirementTotal: "700",
    hsa: "100",
    ltBrokerage: "200",
    espp: "50",
    rBrokerage: "150",
    cash: "100",
    houseValue: "0",
    otherAssets: "25",
    mortgageBalance: "0",
    otherLiabilities: "5",
    grossIncome: "90000",
    combinedAgi: "80000",
    ssaEarnings: null,
    effectiveTaxRate: "0.12",
    taxesPaid: null,
    propertyTaxes: "300",
    portfolioByTaxLocation: null,
  });

  it("builds a year's row from finalized performance first, the stored row otherwise", () => {
    const perf = performance();
    const { mortgageBalanceByYear } = mortgageBalanceByYearFrom(
      [],
      [],
      [],
      new Date(2026, 0, 1),
    );
    expect(mortgageBalanceByYear.size).toBe(0);
    const { history } = storedYearEndRows(
      [nwRow("2019-12-31"), nwRow("2024-12-31")],
      perf.perfPortfolioByYear,
      perf.perfSummaryByYear,
      mortgageBalanceByYear,
      new Map([[2024, 4000]]),
      new Map([[2024, 150]]),
      perf.perfByAccountByYear,
      perf.perfByCategoryByYear,
      perf.perfByParentCategoryByYear,
    );
    const [old, finalized] = history;
    expect(old).toMatchObject({
      year: 2019,
      isCurrent: false,
      portfolioTotal: 1200,
      portfolioByType: { "401k": 700, hsa: 100, brokerage: 400 },
      netWorth: 1320,
      propertyTaxes: 300,
      perfEndingBalance: null,
      homeImprovements: 0,
    });
    expect(finalized).toMatchObject({
      year: 2024,
      portfolioTotal: 1500,
      netWorth: 1620,
      propertyTaxes: 150,
      perfEndingBalance: 1500.5,
      homeImprovements: 4000,
      effectiveTaxRate: 0.12,
      ssaEarnings: null,
      ytdRatio: 1,
    });
  });
});
