import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RefinanceCalculator } from "@/components/mortgage/refinance-calculator";
import type { LoanSummary } from "@/components/mortgage/types";

vi.mock("@/components/ui/card", () => ({
  Card: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title?: string;
  }) => (
    <div data-testid="card">
      {title && <h3>{title}</h3>}
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

const baseLoan: LoanSummary = {
  loanId: 1,
  name: "Primary Mortgage",
  currentBalance: 300000,
  remainingMonths: 300,
  totalInterestLife: 250000,
  totalInterestPaid: 50000,
  totalInterestSaved: 0,
  monthsAheadOfSchedule: 0,
  payoffDate: "2050-01-01",
  payoffPercent: 25,
  amortizationSchedule: [
    {
      month: 1,
      date: "2025-04-01",
      payment: 1800,
      principal: 400,
      interest: 1400,
      extraPayment: 0,
      balance: 299600,
    },
  ],
};

describe("RefinanceCalculator", () => {
  it("renders collapsed by default with toggle button", () => {
    render(<RefinanceCalculator currentLoan={baseLoan} />);
    expect(
      screen.getByText("Compare a refinance scenario..."),
    ).toBeInTheDocument();
    expect(screen.queryByText("New Interest Rate (%)")).toBeNull();
  });

  it("expands when toggle is clicked", () => {
    render(<RefinanceCalculator currentLoan={baseLoan} />);
    fireEvent.click(screen.getByText("Compare a refinance scenario..."));
    expect(screen.getByText("New Interest Rate (%)")).toBeInTheDocument();
    expect(screen.getByText("New Term (years)")).toBeInTheDocument();
    expect(screen.getByText("Closing Costs ($)")).toBeInTheDocument();
  });

  it("shows results when rate is entered", () => {
    render(<RefinanceCalculator currentLoan={baseLoan} />);
    fireEvent.click(screen.getByText("Compare a refinance scenario..."));

    const rateInput = screen.getByPlaceholderText("5.5");
    fireEvent.change(rateInput, { target: { value: "5.0" } });

    expect(screen.getByText("Current Payment")).toBeInTheDocument();
    expect(screen.getByText("New Payment")).toBeInTheDocument();
    expect(screen.getByText("Net Savings")).toBeInTheDocument();
  });

  it("calculates correct new monthly payment", () => {
    render(<RefinanceCalculator currentLoan={baseLoan} />);
    fireEvent.click(screen.getByText("Compare a refinance scenario..."));

    fireEvent.change(screen.getByPlaceholderText("5.5"), {
      target: { value: "5.0" },
    });

    // P&I formula: (300000 * 0.004167 * 1.004167^360) / (1.004167^360 - 1) ≈ $1,610.46
    const newPaymentSection = screen.getByText("New Payment").parentElement!;
    const paymentText =
      newPaymentSection.querySelector(".text-lg")?.textContent;
    // Should be approximately $1,610
    expect(paymentText).toMatch(/\$1,61[0-1]/);
  });

  it("shows break-even months when closing costs are entered", () => {
    render(<RefinanceCalculator currentLoan={baseLoan} />);
    fireEvent.click(screen.getByText("Compare a refinance scenario..."));

    fireEvent.change(screen.getByPlaceholderText("5.5"), {
      target: { value: "4.0" },
    });

    // With 5000 closing costs (default) and monthly savings, should show break-even
    expect(screen.getByText(/months to break even/)).toBeInTheDocument();
  });

  it("can be collapsed after expanding", () => {
    render(<RefinanceCalculator currentLoan={baseLoan} />);
    fireEvent.click(screen.getByText("Compare a refinance scenario..."));
    expect(screen.getByText("New Interest Rate (%)")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Hide refinance calculator"));
    expect(screen.queryByText("New Interest Rate (%)")).toBeNull();
  });

  it("defaults to 30-year term", () => {
    render(<RefinanceCalculator currentLoan={baseLoan} />);
    fireEvent.click(screen.getByText("Compare a refinance scenario..."));

    const select = screen.getByDisplayValue("30 years");
    expect(select).toBeInTheDocument();
  });

  it("shows current payment from amortization schedule", () => {
    render(<RefinanceCalculator currentLoan={baseLoan} />);
    fireEvent.click(screen.getByText("Compare a refinance scenario..."));
    fireEvent.change(screen.getByPlaceholderText("5.5"), {
      target: { value: "5.0" },
    });

    // Current payment should show $1,800 from amortizationSchedule[0].payment
    const currentPaymentSection =
      screen.getByText("Current Payment").parentElement!;
    expect(currentPaymentSection.textContent).toContain("1,800");
  });
});
