import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Smoke tests for src/components/networth/ — this directory previously had
// zero test coverage. These are pure presentational components (props in,
// JSX out; no tRPC calls of their own — data is fetched by the parent
// net-worth page), so we render them directly with representative props.
// Follows the leaf-component smoke pattern from
// tests/components/contribution-accounts-card.test.tsx: mock HelpTip
// (radix tooltip — noisy/irrelevant to these tests) and recharts (heavy,
// canvas-less in jsdom), exercise real Card/InlineEdit.

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: ({ name }: { name?: string }) => <div data-testid="line">{name}</div>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

import { AssetsLiabilitiesCards } from "@/components/networth/assets-liabilities-cards";
import { FinancialIndependenceCard } from "@/components/networth/financial-independence-card";
import { NetWorthComposition } from "@/components/networth/net-worth-composition";
import { JourneyToAbundanceChart } from "@/components/networth/journey-to-abundance-chart";
import type { HistoryRow } from "@/components/networth/types";

describe("AssetsLiabilitiesCards smoke", () => {
  const baseProps = {
    portfolioTotal: 500000,
    portfolioAccounts: [
      { taxType: "preTax", amount: 300000 },
      { taxType: "taxFree", amount: 200000 },
    ],
    byTaxType: new Map([
      ["preTax", 300000],
      ["taxFree", 200000],
    ]),
    cash: 20000,
    cashSource: "manual" as const,
    displayHomeValue: 400000,
    otherAssets: 0,
    mortgageBalance: 250000,
    otherLiabilities: 0,
    totalLiabilities: 250000,
    useMarketValue: true,
    hasHouse: true,
    onSettingUpdate: vi.fn(),
  };

  it("renders without crashing with a house and manual cash", () => {
    render(<AssetsLiabilitiesCards {...baseProps} />);
    expect(screen.getByText("Assets")).toBeInTheDocument();
    expect(screen.getByText("Liabilities")).toBeInTheDocument();
    expect(screen.getByText("Mortgage Balance")).toBeInTheDocument();
    expect(screen.getByText("Home Equity")).toBeInTheDocument();
  });

  it("shows synced cash badge when cashSource is not manual", () => {
    render(<AssetsLiabilitiesCards {...baseProps} cashSource="ynab" />);
    expect(screen.getByText("Synced from YNAB")).toBeInTheDocument();
  });

  it("hides house-related rows when hasHouse is false (no mortgage/equity)", () => {
    render(<AssetsLiabilitiesCards {...baseProps} hasHouse={false} />);
    expect(screen.queryByText("Mortgage Balance")).toBeNull();
    expect(screen.queryByText("Home Equity")).toBeNull();
  });

  it("renders itemized other assets when otherAssetItems is populated", () => {
    render(
      <AssetsLiabilitiesCards
        {...baseProps}
        otherAssetItems={[
          { name: "Crypto", value: 15000, synced: false },
          { name: "Collectibles", value: 5000, synced: false },
        ]}
      />,
    );
    expect(screen.getByText("Crypto")).toBeInTheDocument();
    expect(screen.getByText("Collectibles")).toBeInTheDocument();
  });

  it("shows other liabilities row when otherLiabilities > 0", () => {
    render(<AssetsLiabilitiesCards {...baseProps} otherLiabilities={10000} />);
    expect(screen.getByText("Other Liabilities")).toBeInTheDocument();
  });
});

describe("FinancialIndependenceCard smoke", () => {
  const baseProps = {
    fiTarget: 1000000,
    fiProgress: 0.5,
    portfolioTotal: 480000,
    cash: 20000,
    withdrawalRate: 0.04,
    currentExpenseColumn: 0,
    onExpenseColumnChange: vi.fn(),
  };

  it("renders 'Run projection' link when fiCache is null (empty state)", () => {
    render(<FinancialIndependenceCard {...baseProps} fiCache={null} />);
    expect(
      screen.getByRole("link", { name: /Run projection/i }),
    ).toBeInTheDocument();
  });

  it("renders 'Unreachable' when fiCache.fiYear is null", () => {
    render(
      <FinancialIndependenceCard
        {...baseProps}
        fiCache={{
          fiYear: null,
          fiAge: null,
          inputKey: "x",
          computedAt: "2026-01-01",
        }}
      />,
    );
    expect(screen.getByText("Unreachable")).toBeInTheDocument();
  });

  it("renders projected FI year + age when fiCache is populated", () => {
    render(
      <FinancialIndependenceCard
        {...baseProps}
        fiCache={{
          fiYear: 2045,
          fiAge: 55,
          inputKey: "x",
          computedAt: "2026-01-01",
        }}
      />,
    );
    expect(screen.getByText("2045 (age 55)")).toBeInTheDocument();
    expect(screen.getByText("Based on retirement plan")).toBeInTheDocument();
  });

  it("renders budget scenario toggle buttons when budgetColumnLabels has >1 entry", () => {
    render(
      <FinancialIndependenceCard
        {...baseProps}
        fiCache={null}
        budgetColumnLabels={["Lean", "Fat"]}
      />,
    );
    expect(screen.getByRole("button", { name: "Lean" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fat" })).toBeInTheDocument();
  });
});

describe("NetWorthComposition smoke", () => {
  const baseProps = {
    portfolioTotal: 500000,
    displayHomeValue: 400000,
    cash: 20000,
    otherAssets: 0,
    totalLiabilities: 250000,
    displayNetWorth: 670000,
    hasHouse: true,
  };

  it("renders without crashing and shows Net Worth total", () => {
    render(<NetWorthComposition {...baseProps} />);
    expect(screen.getByText("Net Worth Composition")).toBeInTheDocument();
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
  });

  it("omits the Home segment when hasHouse is false", () => {
    render(<NetWorthComposition {...baseProps} hasHouse={false} />);
    expect(screen.queryByText("Home")).toBeNull();
  });

  it("includes an Other segment when otherAssets > 0", () => {
    render(<NetWorthComposition {...baseProps} otherAssets={10000} />);
    expect(screen.getByText("Other")).toBeInTheDocument();
  });
});

describe("JourneyToAbundanceChart smoke", () => {
  const mkRow = (overrides: Partial<HistoryRow>): HistoryRow => ({
    year: 2020,
    netWorth: 100000,
    portfolioTotal: 80000,
    cash: 10000,
    houseValue: 0,
    mortgageBalance: 0,
    totalLiabilities: 0,
    grossIncome: 0,
    effectiveIncome: 0,
    averageAge: 30,
    isCurrent: false,
    ...overrides,
  });

  it("renders nothing (returns null) when fewer than 2 history rows are given", () => {
    const { container } = render(
      <JourneyToAbundanceChart
        history={[mkRow({ year: 2020 })]}
        primaryBirthYear={1990}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders chart + benchmark note when populated without income data", () => {
    render(
      <JourneyToAbundanceChart
        history={[
          mkRow({ year: 2020, averageAge: 30 }),
          mkRow({ year: 2021, averageAge: 31 }),
        ]}
        primaryBirthYear={1990}
      />,
    );
    expect(screen.getByText("Journey to Abundance")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(
      screen.getByText(/Add gross income to annual net worth records/i),
    ).toBeInTheDocument();
  });

  it("renders benchmark lines and omits the note when income data is present", () => {
    render(
      <JourneyToAbundanceChart
        history={[
          mkRow({ year: 2020, averageAge: 30, effectiveIncome: 100000 }),
          mkRow({ year: 2021, averageAge: 31, effectiveIncome: 105000 }),
        ]}
        primaryBirthYear={1990}
      />,
    );
    expect(screen.getByText("Avg Wealth")).toBeInTheDocument();
    expect(screen.getByText("Prodigious Wealth")).toBeInTheDocument();
    expect(
      screen.queryByText(/Add gross income to annual net worth records/i),
    ).toBeNull();
  });
});
