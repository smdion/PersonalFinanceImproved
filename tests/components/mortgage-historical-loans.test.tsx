import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Smoke tests for src/components/mortgage/historical-loans.tsx — paid-off /
// refinanced loan history cards with toggleable amortization schedules.
// src/components/mortgage/ had no tests prior to this.

vi.mock("@/components/mortgage/amortization-table", () => ({
  AmortizationTable: () => <div data-testid="amortization-table" />,
}));

import { HistoricalLoans } from "@/components/mortgage/historical-loans";
import type {
  LoanSummary,
  LoanHistoryEntry,
} from "@/components/mortgage/types";

const mkLoan = (overrides: Partial<LoanSummary>): LoanSummary => ({
  loanId: 1,
  name: "Original 30yr",
  currentBalance: 0,
  remainingMonths: 0,
  totalInterestLife: 0,
  amortizationSchedule: [
    {
      month: 1,
      date: "2020-01-01",
      payment: 1770,
      principal: 500,
      interest: 1270,
      extraPayment: 0,
      balance: 279500,
    },
  ],
  payoffDate: "2050-01-01",
  payoffPercent: 1,
  totalInterestPaid: 45000,
  totalInterestSaved: 0,
  monthsAheadOfSchedule: 0,
  ...overrides,
});

describe("HistoricalLoans smoke", () => {
  it("renders a Refinanced badge and chain note for a refinanced loan", () => {
    const loan = mkLoan({ wasRefinanced: true, endedBalance: 260000 });
    const history: LoanHistoryEntry[] = [
      {
        loanId: 1,
        name: "Original 30yr",
        isActive: false,
        interestRate: 0.065,
        refinancedInto: "Refi 20yr",
      },
    ];
    render(
      <HistoricalLoans
        historicalLoans={[loan]}
        loanHistory={history}
        showHistSchedule={null}
        onToggleHistSchedule={vi.fn()}
      />,
    );
    expect(screen.getByText("Historical Loans")).toBeInTheDocument();
    expect(screen.getAllByText("Refinanced").length).toBeGreaterThan(0);
    expect(screen.getByText("into Refi 20yr")).toBeInTheDocument();
  });

  it("renders a Paid Off badge for a non-refinanced (paid-off) loan", () => {
    const loan = mkLoan({
      name: "Paid off loan",
      wasRefinanced: false,
      paidOffDate: "2024-01-01",
      endedBalance: 0,
    });
    render(
      <HistoricalLoans
        historicalLoans={[loan]}
        loanHistory={[]}
        showHistSchedule={null}
        onToggleHistSchedule={vi.fn()}
      />,
    );
    expect(screen.getByText("Paid Off")).toBeInTheDocument();
    expect(screen.queryByText("Refinanced")).toBeNull();
  });

  it("toggles the amortization schedule visibility via the show/hide button", () => {
    const loan = mkLoan({});
    const onToggle = vi.fn();
    const { rerender } = render(
      <HistoricalLoans
        historicalLoans={[loan]}
        loanHistory={[]}
        showHistSchedule={null}
        onToggleHistSchedule={onToggle}
      />,
    );
    expect(screen.queryByTestId("amortization-table")).toBeNull();
    fireEvent.click(screen.getByText("Show amortization schedule"));
    expect(onToggle).toHaveBeenCalledWith(0);

    rerender(
      <HistoricalLoans
        historicalLoans={[loan]}
        loanHistory={[]}
        showHistSchedule={0}
        onToggleHistSchedule={onToggle}
      />,
    );
    expect(screen.getByTestId("amortization-table")).toBeInTheDocument();
    expect(screen.getByText("Hide amortization schedule")).toBeInTheDocument();
  });

  it("renders multiple historical loans", () => {
    render(
      <HistoricalLoans
        historicalLoans={[
          mkLoan({ name: "Loan A" }),
          mkLoan({ name: "Loan B", loanId: 2 }),
        ]}
        loanHistory={[]}
        showHistSchedule={null}
        onToggleHistSchedule={vi.fn()}
      />,
    );
    expect(screen.getByText("Loan A")).toBeInTheDocument();
    expect(screen.getByText("Loan B")).toBeInTheDocument();
  });
});
