/**
 * The year-end history's wealth-metric pass (lib/pure/net-worth/
 * year-end-metrics.ts), on an invented two-person household with two
 * stored years. The full rows stay pinned in tests/baseline.
 */
import { describe, expect, it } from "vitest";
import { yearEndWealthMetrics } from "@/lib/pure/net-worth/year-end-metrics";
import type { YearEndRow } from "@/lib/pure/net-worth/year-end-rows";

function row(year: number, fields: Partial<YearEndRow>): YearEndRow {
  return {
    year,
    yearEndDate: `${year}-12-31`,
    isCurrent: false,
    netWorth: 0,
    portfolioTotal: 0,
    portfolioByType: {},
    cash: 0,
    houseValue: 0,
    otherAssets: 0,
    homeImprovements: 0,
    mortgageBalance: 0,
    otherLiabilities: 0,
    grossIncome: 0,
    combinedAgi: 0,
    ssaEarnings: null,
    effectiveTaxRate: null,
    taxesPaid: null,
    propertyTaxes: null,
    perfBeginningBalance: null,
    perfContributions: null,
    perfEmployerMatch: null,
    perfGainLoss: null,
    perfEndingBalance: null,
    perfReturnPct: null,
    perfByAccount: [],
    perfLastUpdated: null,
    snapshotDate: null,
    snapshotAgeDays: null,
    performanceByCategory: {},
    portfolioByTaxLocation: null,
    performanceByParentCategory: {},
    ytdRatio: 1,
    wealthScoreMarket: 0,
    wealthScoreCostBasis: 0,
    aawScoreMarket: 0,
    aawScoreCostBasis: 0,
    fiProgress: 0,
    fiTarget: 0,
    netWorthMarket: 0,
    netWorthCostBasis: 0,
    houseValueCostBasis: 0,
    averageAge: 0,
    effectiveIncome: 0,
    lifetimeEarnings: 0,
    annualExpenses: 0,
    withdrawalRate: 0,
    withdrawalRateIsDefault: false,
    ...fields,
  };
}

const people = [
  { id: 1, isPrimaryUser: true, dateOfBirth: "1980-05-01" },
  { id: 2, isPrimaryUser: false, dateOfBirth: "1984-09-15" },
];

function history() {
  return [
    row(2025, {
      portfolioTotal: 300000,
      cash: 20000,
      houseValue: 400000,
      homeImprovements: 10000,
      mortgageBalance: 250000,
      otherLiabilities: 5000,
      grossIncome: 150000,
    }),
    row(2024, { portfolioTotal: 250000, combinedAgi: 120000 }),
  ];
}

describe("yearEndWealthMetrics", () => {
  it("sorts the rows and fills each one's ages, earnings and cost-basis figures", () => {
    const rows = history();
    yearEndWealthMetrics(
      rows,
      [],
      people,
      [{ profileId: 1, personId: 1, withdrawalRate: "0.035" }],
      [{ id: 1 }],
      [{ isActive: true, propertyValuePurchase: "350000" }],
      60000,
    );
    expect(rows.map((r) => r.year)).toEqual([2024, 2025]);
    const [first, second] = rows;
    expect(first).toMatchObject({
      averageAge: 42,
      effectiveIncome: 120000,
      lifetimeEarnings: 120000,
      houseValueCostBasis: 0,
      netWorthCostBasis: 250000,
      annualExpenses: 60000,
      withdrawalRate: 0.035,
      withdrawalRateIsDefault: false,
    });
    expect(second).toMatchObject({
      averageAge: 43,
      effectiveIncome: 150000,
      lifetimeEarnings: 270000,
      houseValueCostBasis: 360000,
      netWorthCostBasis: 300000 + 20000 + 360000 - 250000 - 5000,
    });
  });

  it("averages the last three years' income when the setting is on", () => {
    const rows = history();
    yearEndWealthMetrics(
      rows,
      [{ key: "use_salary_average_3_year", value: 1 }],
      people,
      [],
      [],
      [],
      60000,
    );
    expect(rows[1]!.effectiveIncome).toBe(135000);
  });

  it("falls back to the default withdrawal rate with no settings row", () => {
    const rows = history();
    yearEndWealthMetrics(rows, [], people, [], [], [], 0);
    expect(rows[0]).toMatchObject({
      withdrawalRate: 0.04,
      withdrawalRateIsDefault: true,
    });
  });
});
