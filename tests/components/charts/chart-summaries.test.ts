/**
 * Each chart's sr-only summary, from fixed data: the sentence a screen
 * reader hears, built only from values the chart plots.
 */
import { describe, it, expect } from "vitest";
import { partsSummary, seriesSummary } from "@/components/charts/chart-summary";
import { pieSummary } from "@/components/charts/pie.summary";
import { netWorthLineSummary } from "@/components/networth/net-worth-line-chart.summary";
import { journeySummary } from "@/components/networth/journey-to-abundance-chart.summary";
import { costTrendSummary } from "@/components/upkeep/cost-trend-chart.summary";
import { budgetVsActualSummary } from "@/components/expenses/expenses-charts.summary";
import type { HistoryRow } from "@/components/networth/types";

const row = (year: number, netWorth: number): HistoryRow => ({
  year,
  netWorth,
  portfolioTotal: 300_000,
  cash: 20_000,
  houseValue: 400_000,
  mortgageBalance: 250_000,
  totalLiabilities: 260_000,
  grossIncome: 150_000,
  effectiveIncome: 150_000,
  averageAge: 40,
  isCurrent: false,
});

describe("seriesSummary and partsSummary", () => {
  it("say the range once when it is one point", () => {
    expect(seriesSummary("Cost", ["2025"], [["Total", "$1"]]).text).toBe(
      "Cost, 2025. 2025: Total $1.",
    );
  });

  it("say nothing is plotted for no points or no parts", () => {
    expect(seriesSummary("Cost", [], []).text).toBe("Cost: nothing plotted.");
    expect(partsSummary("Mix", []).text).toBe("Mix: nothing plotted.");
  });
});

describe("chart summaries", () => {
  it("net worth line, by year", () => {
    expect(
      netWorthLineSummary([row(2024, 400_000), row(2025, 460_000)]),
    ).toEqual({
      label: "Net worth over time",
      text: "Net worth over time, 2024 to 2025. 2025: Net Worth $460,000.00; Portfolio $300,000.00; House $400,000.00; Cash $20,000.00; Liabilities $260,000.00.",
    });
  });

  it("net worth line, by age", () => {
    const rows = [row(2024, 1), row(2025, 2)].map((r, i) => ({
      ...r,
      displayAge: 40 + i,
    }));
    expect(netWorthLineSummary(rows).text).toMatch(
      /^Net worth over time, Age 40 to Age 41\. Age 41: Net Worth \$2\.00;/,
    );
  });

  it("journey to abundance, with and without the benchmark lines", () => {
    const points = [
      {
        year: 2024,
        age: 40,
        netWorth: 500_000,
        portfolio: 300_000,
        avgWealth: 600_000,
        prodigiousWealth: 1_200_000,
      },
      {
        year: 2025,
        age: 41,
        netWorth: 550_000,
        portfolio: 330_000,
        avgWealth: 610_000,
        prodigiousWealth: 1_220_000,
      },
    ];
    expect(journeySummary(points, false, true).text).toBe(
      "Journey to abundance, Age 40 to Age 41. Age 41: Avg Wealth $610,000.00; Prodigious Wealth $1,220,000.00; Portfolio $330,000.00; Net Worth $550,000.00.",
    );
    expect(journeySummary(points, true, false).text).toBe(
      "Journey to abundance, 2024 to 2025. 2025: Portfolio $330,000.00; Net Worth $550,000.00.",
    );
  });

  it("location and spending pies", () => {
    expect(
      pieSummary("Net worth location", [
        { name: "Portfolio", value: 300_000 },
        { name: "Cash", value: 20_000.5 },
      ]),
    ).toEqual({
      label: "Net worth location",
      text: "Net worth location: Portfolio $300,000.00; Cash $20,000.50.",
    });
  });

  it("utility cost trend", () => {
    expect(
      costTrendSummary([
        { year: 2024, cost: 1_800 },
        { year: 2025, cost: 1_950 },
      ]).text,
    ).toBe("Annual utility cost, 2024 to 2025. 2025: Year total $1,950.00.");
  });

  it("budget vs actual", () => {
    expect(
      budgetVsActualSummary([
        { name: "Housing", budgeted: 2_000, actual: 2_100 },
        { name: "Food", budgeted: 800, actual: 650 },
      ]).text,
    ).toBe(
      "Budget vs actual by group: Housing budgeted $2,000.00, actual $2,100.00; Food budgeted $800.00, actual $650.00.",
    );
  });
});
