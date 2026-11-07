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
import { balanceSummary } from "@/components/retirement-projection/projection-chart.summary";
import { stabilitySummary } from "@/components/retirement-projection/spending-stability-chart.summary";
import { strategyLinesSummary } from "@/components/retirement-projection/withdrawal-comparison.summary";
import { trajectorySummary } from "@/components/savings/savings-trajectory-chart.summary";
import { fundMiniSummary } from "@/components/savings/fund-mini-chart.summary";
import { glidePathSummary } from "@/components/investments/glide-path-chart.summary";
import { comparisonSummary } from "@/components/investments/comparison-section.summary";
import {
  portfolioSummary,
  stackedSummary,
} from "@/components/portfolio/portfolio-chart.summary";

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

  it("savings goal trajectories", () => {
    expect(
      trajectorySummary([
        { month: "2026-01", Emergency: 5_000, Car: 1_000 },
        { month: "2026-12", Emergency: 9_000, Car: -250 },
      ]).text,
    ).toBe(
      "Goal trajectories, Jan 2026 to Dec 2026. Dec 2026: Emergency $9,000.00; Car -$250.00.",
    );
  });

  it("a fund's mini chart, with and without a target", () => {
    const dates = [new Date(2026, 0, 1), new Date(2026, 1, 1)];
    expect(fundMiniSummary([100, 200], dates, 1_000).text).toBe(
      "Fund balance by month, Jan 2026 to Feb 2026. Feb 2026: Balance $200.00; Target $1,000.00.",
    );
    expect(fundMiniSummary([100, 200], dates, 0).text).toBe(
      "Fund balance by month, Jan 2026 to Feb 2026. Feb 2026: Balance $200.00.",
    );
  });

  it("glide path, with the Vanguard line", () => {
    const key = (id: number) => `c${id}`;
    const points = [
      { age: 25, c1: 90, c2: 10, vanguard: 90 },
      { age: 95, c1: 30, c2: 70, vanguard: 30 },
    ];
    expect(
      glidePathSummary(
        points,
        [
          { assetClassId: 1, name: "US stocks" },
          { assetClassId: 2, name: "Bonds" },
        ],
        key,
      ).text,
    ).toBe(
      "Target mix by age, Age 25 to Age 95. Age 95: US stocks 30%; Bonds 70%; Vanguard target-date stocks 30%.",
    );
  });

  it("you vs the market, the shown index runs only", () => {
    expect(
      comparisonSummary(
        [
          { label: "2024", deposits: 10_000, you: 11_000, sp: 11_500 },
          {
            label: "2025 so far",
            deposits: 12_000,
            you: 14_000,
            sp: 14_400,
            bonds: 12_100,
          },
        ],
        [{ key: "sp", label: "the S&P 500" }],
      ).text,
    ).toBe(
      "How you did vs the market, 2024 to 2025 so far. 2025 so far: What you put in $12,000.00; You $14,000.00; Same money in the S&P 500 $14,400.00.",
    );
  });

  it("portfolio value: a snapshot total, or the live estimate after it", () => {
    expect(
      portfolioSummary([
        { label: "Jan 5, 26", total: 100_000 },
        { label: "Feb 5, 26", total: 101_000 },
      ]).text,
    ).toBe(
      "Portfolio value, Jan 5, 26 to Feb 5, 26. Feb 5, 26: Total $101,000.00.",
    );
    expect(
      portfolioSummary([
        { label: "Feb 5, 26", total: 101_000, live: 101_000 },
        { label: "Feb 6, 26", total: null, live: 101_250.5 },
      ]).text,
    ).toBe(
      "Portfolio value, Feb 5, 26 to Feb 6, 26. Feb 6, 26: Live estimate ≈ $101,250.50.",
    );
  });

  it("portfolio value by account", () => {
    expect(
      stackedSummary(
        [
          { date: "2026-01-05", label: "Jan 5, 26", a: 60_000, b: 40_000 },
          { date: "2026-02-05", label: "Feb 5, 26", a: 61_000, b: 39_500 },
        ],
        [
          { key: "a", label: "401k" },
          { key: "b", label: "IRA" },
        ],
      ).text,
    ).toBe(
      "Portfolio value by account, Jan 5, 26 to Feb 5, 26. Feb 5, 26: 401k $61,000.00; IRA $39,500.00.",
    );
  });

  it("balance projection: shown segments, typical outcome and income", () => {
    const segments = [
      { key: "preTax", label: "Traditional" },
      { key: "taxFree", label: "Roth" },
    ];
    expect(
      balanceSummary(
        [
          { year: 2030, preTax: 500_000, taxFree: 100_000 },
          {
            year: 2060,
            preTax: 0,
            taxFree: 250_000,
            mc_p50: 240_000,
            _totalWithdrawal: 40_000,
            _ssIncome: 0,
          },
        ],
        segments,
      ).text,
    ).toBe(
      "Balance projection, 2030 to 2060. 2060: Roth $250,000.00; Typical outcome $240,000.00; Portfolio withdrawal $40,000.00/yr.",
    );
  });

  it("yearly income stability, with the Simulation lines", () => {
    expect(
      stabilitySummary(
        [
          { year: 2040, ratio: 100 },
          { year: 2070, ratio: 92.5, mc_p50: 98.1, mc_breach: 4.2 },
        ],
        "Budget",
      ).text,
    ).toBe(
      "Yearly income stability vs Budget, 2040 to 2070. 2070: vs Budget 92.5%; Sim. median 98.1%; Breached floor 4.2% of sims.",
    );
    expect(
      stabilitySummary([{ year: 2040, ratio: 100, mc_breach: 0 }], "Strategy")
        .text,
    ).toBe(
      "Yearly income stability vs Strategy, 2040. 2040: vs Strategy 100.0%.",
    );
  });

  it("withdrawal strategy comparison, by metric", () => {
    const strategies = [
      { strategy: "fixed", shortLabel: "Fixed" },
      { strategy: "guyton_klinger", shortLabel: "Guardrails" },
    ];
    const rows = [
      { year: 2040, fixed: 1_000_000, guyton_klinger: 1_000_000 },
      { year: 2070, fixed: 200_000, guyton_klinger: 450_000 },
    ];
    expect(
      strategyLinesSummary(rows, strategies, "retirementBalance").text,
    ).toBe(
      "Portfolio balance by strategy, 2040 to 2070. 2070: Fixed $200,000.00; Guardrails $450,000.00.",
    );
    expect(strategyLinesSummary(rows, strategies, "withdrawal").label).toBe(
      "Annual withdrawal by strategy",
    );
  });
});
