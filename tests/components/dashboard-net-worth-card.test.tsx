import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Direct smoke test for src/components/cards/dashboard/net-worth-card.tsx.
// tests/components/dashboard.test.tsx mocks out all dashboard cards at the
// page level, so individual cards (including this one) have zero direct
// coverage. Follows the leaf-component tRPC-mock pattern from
// tests/components/portfolio-content-smoke.test.tsx.

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

vi.mock("@/lib/hooks/use-year-end-targeting", () => ({
  useYearEndTargetingInput: () => ({}),
}));

let networthQuery: {
  data: unknown;
  isLoading: boolean;
  error: unknown;
} = { data: undefined, isLoading: true, error: null };
let syncStatusData: { lastSynced?: string; service?: string } | undefined =
  undefined;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    networth: {
      computeSummary: { useQuery: () => networthQuery },
    },
    sync: {
      getSyncStatus: { useQuery: () => ({ data: syncStatusData }) },
    },
  },
}));

import { NetWorthCard } from "@/components/cards/dashboard/net-worth-card";

const mockData = {
  result: { netWorthMarket: 670000, netWorthCostBasis: 620000 },
  homeValueEstimated: 400000,
  homeValueConservative: 380000,
  portfolioTotal: 500000,
  cash: 20000,
  hasHouse: true,
  mortgageBalance: 250000,
  snapshotDate: "2026-04-01",
  cashSource: "manual",
  otherAssetItems: [],
};

describe("NetWorthCard smoke", () => {
  it("renders a loading skeleton while the query is pending", () => {
    networthQuery = { data: undefined, isLoading: true, error: null };
    render(<NetWorthCard />);
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
  });

  it("renders an error card when the query fails", () => {
    networthQuery = {
      data: undefined,
      isLoading: false,
      error: new Error("x"),
    };
    render(<NetWorthCard />);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("renders the empty-state prompt when there is no data", () => {
    networthQuery = { data: undefined, isLoading: false, error: null };
    render(<NetWorthCard />);
    expect(
      screen.getByText("Add a portfolio snapshot to start tracking net worth."),
    ).toBeInTheDocument();
  });

  it("renders market net worth, home value, cash, and mortgage rows", () => {
    networthQuery = { data: mockData, isLoading: false, error: null };
    render(<NetWorthCard />);
    expect(screen.getByText("$670,000.00")).toBeInTheDocument();
    expect(screen.getByText("Home (est.)")).toBeInTheDocument();
    expect(screen.getByText("$400,000.00")).toBeInTheDocument();
    expect(screen.getByText("Mortgage")).toBeInTheDocument();
    expect(screen.getByText("Snapshot Apr 1, 2026")).toBeInTheDocument();
  });

  it("toggles to cost-basis net worth when the Market/Cost Basis button is clicked", () => {
    networthQuery = { data: mockData, isLoading: false, error: null };
    render(<NetWorthCard />);
    fireEvent.click(screen.getByRole("button", { name: "Market" }));
    expect(screen.getByText("$620,000.00")).toBeInTheDocument();
    expect(screen.getByText("Home (cost)")).toBeInTheDocument();
    expect(screen.getByText("$380,000.00")).toBeInTheDocument();
  });

  it("hides house-related rows when hasHouse is false", () => {
    networthQuery = {
      data: { ...mockData, hasHouse: false },
      isLoading: false,
      error: null,
    };
    render(<NetWorthCard />);
    expect(screen.queryByText("Mortgage")).toBeNull();
  });

  it("shows a synced-source freshness note when cash comes from a linked budget API", () => {
    networthQuery = {
      data: { ...mockData, cashSource: "ynab" },
      isLoading: false,
      error: null,
    };
    syncStatusData = { lastSynced: "2026-08-07T10:00:00Z", service: "ynab" };
    render(<NetWorthCard />);
    expect(screen.getByText(/YNAB synced/)).toBeInTheDocument();
  });
});
