import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Direct smoke test for src/components/dashboard/net-worth-card.tsx.
// tests/components/dashboard/dashboard.test.tsx mocks out all dashboard cards at the
// page level, so individual cards (including this one) have zero direct
// coverage. Follows the leaf-component tRPC-mock pattern from
// tests/components/portfolio-content-smoke.test.tsx.

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

vi.mock("@/lib/hooks/use-dashboard-projection", () => ({
  useDashboardProjection: () => ({ data: undefined }),
}));
vi.mock("@/lib/hooks/use-year-end-targeting", () => ({
  useYearEndTargetingInput: () => ({}),
}));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../trpc-mock")).trpc,
}));
import {
  resetTrpcMock,
  setQuery,
  setQueryState,
  type MockOutput,
} from "../trpc-mock";

const SUMMARY = "networth.computeSummary";
/** The summary query: its data, loading and error. */
function networth({
  data,
  isLoading,
  error,
}: {
  data: MockOutput<typeof SUMMARY> | undefined;
  isLoading: boolean;
  error: unknown;
}) {
  setQuery(SUMMARY, data);
  setQueryState(SUMMARY, { isLoading, error });
}

beforeEach(() => resetTrpcMock());

import { NetWorthCard } from "@/components/dashboard/net-worth-card";

const mockData = {
  result: { netWorthMarket: 670000, netWorthCostBasis: 620000 },
  homeValueEstimated: 400000,
  homeValueConservative: 380000,
  portfolioTotal: 500000,
  cash: 20000,
  hasHouse: true,
  mortgageBalance: 250000,
  snapshotDate: "2026-04-01",
  cashSource: "manual" as const,
  otherAssetItems: [],
};

describe("NetWorthCard smoke", () => {
  it("renders a loading skeleton while the query is pending", () => {
    networth({ data: undefined, isLoading: true, error: null });
    render(<NetWorthCard />);
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
  });

  it("renders an error card when the query fails", () => {
    networth({
      data: undefined,
      isLoading: false,
      error: new Error("x"),
    });
    render(<NetWorthCard />);
    expect(
      screen.getByText("Couldn't load Net Worth. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders the empty-state prompt when there is no data", () => {
    networth({ data: undefined, isLoading: false, error: null });
    render(<NetWorthCard />);
    expect(
      screen.getByText("Add a portfolio snapshot to start tracking net worth."),
    ).toBeInTheDocument();
  });

  it("renders market net worth, home value, cash, and mortgage rows", () => {
    networth({ data: mockData, isLoading: false, error: null });
    render(<NetWorthCard />);
    expect(screen.getByText("$670,000.00")).toBeInTheDocument();
    expect(screen.getByText("Home (est.)")).toBeInTheDocument();
    expect(screen.getByText("$400,000.00")).toBeInTheDocument();
    expect(screen.getByText("Mortgage")).toBeInTheDocument();
    expect(screen.getByText("Snapshot Apr 1, 2026")).toBeInTheDocument();
  });

  it("toggles to cost-basis net worth when the Market/Cost Basis button is clicked", () => {
    networth({ data: mockData, isLoading: false, error: null });
    render(<NetWorthCard />);
    fireEvent.click(screen.getByRole("button", { name: "Market" }));
    expect(screen.getByText("$620,000.00")).toBeInTheDocument();
    expect(screen.getByText("Home (cost)")).toBeInTheDocument();
    expect(screen.getByText("$380,000.00")).toBeInTheDocument();
  });

  it("hides house-related rows when hasHouse is false", () => {
    networth({
      data: { ...mockData, hasHouse: false },
      isLoading: false,
      error: null,
    });
    render(<NetWorthCard />);
    expect(screen.queryByText("Mortgage")).toBeNull();
  });

  it("shows a synced-source freshness note when cash comes from a linked budget API", () => {
    networth({
      data: { ...mockData, cashSource: "ynab" },
      isLoading: false,
      error: null,
    });
    setQuery("sync.getSyncStatus", {
      lastSynced: "2026-08-07T10:00:00Z",
      service: "ynab",
    });
    render(<NetWorthCard />);
    expect(screen.getByText(/YNAB synced/)).toBeInTheDocument();
  });
});
