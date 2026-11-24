/**
 * The Relocation tool's key metrics, banner and warnings: each figure card
 * shows its figure, and each calculator warning shows.
 */
import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { RelocationMetricsAndBanner } from "@/components/tools/relocation/metrics-and-banner";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

type Props = ComponentProps<typeof RelocationMetricsAndBanner>;

const result: Props["result"] = {
  currentAnnualExpenses: 48000,
  relocationAnnualExpenses: 54000,
  annualExpenseDelta: 6000,
  monthlyExpenseDelta: 500,
  percentExpenseIncrease: 0.125,
  currentSavingsRate: 0.25,
  relocationSavingsRate: 0.23,
  savingsRateDrop: 0.02,
  currentFiTarget: 1000000,
  relocationFiTarget: 1150000,
  additionalNestEggNeeded: 150000,
  currentFiAge: 55,
  relocationFiAge: 57,
  fiAgeDelay: 2,
  currentFiYear: 2041,
  relocationFiYear: 2043,
  recommendedPortfolioToRelocate: 800000,
  earliestRelocateAge: 45,
  earliestRelocateYear: 2031,
  totalLargePurchasePortfolioHit: 0,
  steadyStateMonthlyFromPurchases: 0,
  retirementAge: 65,
  projectionByYear: [],
  warnings: ["A calculator warning"],
};

const engineResult: NonNullable<Props["engineResult"]> = {
  currentBalanceAtRetirement: 1500000,
  relocationBalanceAtRetirement: 1200000,
  relocationFiTarget: 1200000,
  currentFiTarget: 1000000,
  isViableNow: false,
  earliestRelocateAge: 50,
  earliestRelocateYear: 2036,
  recommendedPortfolioToRelocate: 900000,
  projectionRows: [],
  blendedRows: null,
  blendedBalanceAtRetirement: null,
  inflationRate: 0.03,
  baseYear: 2026,
};

describe("RelocationMetricsAndBanner", () => {
  it("shows the key metrics from the engine's FI targets", () => {
    render(
      <RelocationMetricsAndBanner
        result={result}
        engineResult={engineResult}
        moveYear={null}
      />,
    );
    expect(screen.getByText("Monthly Delta")).toBeInTheDocument();
    expect(screen.getByText("Additional Nest Egg Needed")).toBeInTheDocument();
    expect(screen.getByText("+$200,000.00")).toBeInTheDocument();
    expect(
      screen.getByText(/Target: \$1,000,000\.00 → \$1,200,000\.00/),
    ).toBeInTheDocument();
    expect(screen.getByText("Portfolio at Retirement")).toBeInTheDocument();
  });

  it("shows each calculator warning", () => {
    render(
      <RelocationMetricsAndBanner
        result={result}
        engineResult={engineResult}
        moveYear={null}
      />,
    );
    expect(screen.getByText("A calculator warning")).toBeInTheDocument();
  });
});
