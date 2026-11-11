/**
 * The Paycheck page's Year to date panel sums the year schedule's checks
 * so far (Social Security at the full rate until the wage base), not the
 * average check times the checks paid.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

import { AnnualSummary } from "@/components/paycheck/annual-summary";
import { calculatePaycheck } from "@/lib/pure/paycheck/per-check";
import type { PeriodBreakdown } from "@/lib/pure/paycheck/paycheck.types";
import { PERSON_A_PAYCHECK_INPUT } from "../pure/fixtures";

const row = (
  periodNumber: number,
  netPay: number,
  ficaSS: number,
): PeriodBreakdown => ({
  periodNumber,
  gross: 1000,
  preTaxDeductions: 0,
  federalWithholding: 100,
  ficaSS,
  ficaMedicare: 14.5,
  postTaxDeductions: 0,
  netPay,
  bonusGross: 0,
  bonusWithholding: 0,
  bonusFica: 0,
});

// Four checks: the first two at full Social Security, then none (past the
// base). The per-check figures are the year's average.
const paycheck = {
  ...calculatePaycheck(PERSON_A_PAYCHECK_INPUT),
  gross: 1000,
  preTaxDeductions: [],
  postTaxDeductions: [],
  federalWithholding: 100,
  ficaSS: 31,
  ficaMedicare: 14.5,
  netPay: 854.5,
  periodsPerYear: 4,
  periodsElapsedYtd: 2,
  periodsBeforeStart: 0,
  yearSchedule: [
    row(1, 823.5, 62),
    row(2, 823.5, 62),
    row(3, 885.5, 0),
    row(4, 885.5, 0),
  ],
};

describe("AnnualSummary, Year to date", () => {
  it("sums the schedule's checks so far, not the average check", () => {
    render(<AnnualSummary paycheck={paycheck} mode="ytd" />);
    expect(screen.getByText("Year to date")).toBeInTheDocument();
    // 2 × 823.50 (the average would give 2 × 854.50 = 1,709.00).
    expect(screen.getByText("$1,647.00")).toBeInTheDocument();
    // 2 × (62 + 14.50)
    expect(screen.getByText("$153.00")).toBeInTheDocument();
    expect(screen.getByText("2 of 4 checks")).toBeInTheDocument();
  });
});
