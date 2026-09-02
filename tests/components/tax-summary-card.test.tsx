/**
 * TaxSummaryCard — decumulation-only lifetime tax summary, collapsed by
 * default. Covers: no-render when there's no decumulation data, the
 * collapsed header's summary figures, and the expanded KPI grid + decade
 * breakdown table's numbers.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: ({ text }: { text?: string }) => (
    <span data-testid="help-tip" title={text} />
  ),
}));

vi.mock("@/lib/utils/format", () => ({
  formatCurrency: (v: number) => `$${Math.round(v).toLocaleString()}`,
  formatPercent: (v: number, d = 0) => `${(v * 100).toFixed(d)}%`,
}));

import { TaxSummaryCard } from "@/components/cards/projection/tax-summary-card";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeState(years: any[]): any {
  return {
    result: { projectionByYear: years },
    deflate: (v: number) => v, // identity — years pre-set to "today's dollars" in fixtures
  };
}

function decumYear(overrides: Record<string, unknown> = {}) {
  return {
    phase: "decumulation" as const,
    year: 2044,
    age: 55,
    taxCost: 10000,
    totalWithdrawal: 50000,
    ...overrides,
  };
}

describe("TaxSummaryCard", () => {
  it("renders nothing when there's no decumulation data", () => {
    const { container } = render(
      <TaxSummaryCard
        state={makeState([{ phase: "accumulation", year: 2026 }])}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when result is null", () => {
    const { container } = render(
      <TaxSummaryCard state={{ result: null, deflate: (v: number) => v }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the collapsed header with total tax and effective rate, KPI grid hidden", () => {
    const years = [
      decumYear({ age: 55, taxCost: 10000, totalWithdrawal: 50000 }),
      decumYear({ age: 56, taxCost: 10000, totalWithdrawal: 50000 }),
    ];
    render(<TaxSummaryCard state={makeState(years)} />);

    // Collapsed header: total = $20,000, rate = 20,000/100,000 = 20%
    expect(screen.getByText("$20,000")).toBeInTheDocument();
    expect(screen.getByText("(20.0% effective)")).toBeInTheDocument();
    expect(screen.queryByText("Lifetime Tax Paid")).not.toBeInTheDocument();
  });

  it("expands to show the KPI grid and decade breakdown on click", () => {
    const years = [
      decumYear({ age: 55, taxCost: 10000, totalWithdrawal: 50000 }),
      decumYear({ age: 65, taxCost: 30000, totalWithdrawal: 100000 }),
    ];
    render(<TaxSummaryCard state={makeState(years)} />);

    fireEvent.click(screen.getByRole("button"));

    // KPI grid now visible
    expect(screen.getByText("Lifetime Tax Paid")).toBeInTheDocument();
    expect(screen.getByText("Effective Tax Rate")).toBeInTheDocument();
    expect(screen.getByText("Avg Tax / Year")).toBeInTheDocument();
    expect(screen.getByText("Over 2 retirement years")).toBeInTheDocument();
    // Avg tax/year = 40000 / 2 = $20,000
    expect(screen.getAllByText("$20,000").length).toBeGreaterThan(0);

    // Decade breakdown: 50s and 60s
    expect(screen.getByText("Tax Paid by Decade")).toBeInTheDocument();
    expect(screen.getByText("50s")).toBeInTheDocument();
    expect(screen.getByText("60s")).toBeInTheDocument();
  });

  it("collapses the decade table's own effective rate to 0% instead of NaN when withdrawalToday is 0", () => {
    const years = [
      decumYear({ age: 55, taxCost: 5000, totalWithdrawal: 0 }),
      decumYear({ age: 65, taxCost: 5000, totalWithdrawal: 10000 }),
    ];
    render(<TaxSummaryCard state={makeState(years)} />);
    fireEvent.click(screen.getByRole("button"));

    // 50s decade: taxToday=5000, withdrawalToday=0 -> rate shown as 0%, not NaN%
    expect(screen.queryByText("NaN%")).not.toBeInTheDocument();
  });
});
