/**
 * The Paycheck page's Bonus panel: a bonus dated after the job's last day
 * isn't paid this year, so the panel names no pay period and shows no gross;
 * an undated one on a job ending this year isn't counted, for want of a date.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

import { BonusSection } from "@/components/paycheck/bonus-section";
import { calculatePaycheck } from "@/lib/pure/paycheck/per-check";
import type { PaycheckInput } from "@/lib/pure/paycheck/paycheck.types";
import { PERSON_A_PAYCHECK_INPUT } from "../pure/fixtures";

// Biweekly Fridays from 2025-01-03; the job's last day is June 10 (check
// 12). A $10,000 set bonus.
const ending: PaycheckInput = {
  ...PERSON_A_PAYCHECK_INPUT,
  asOfDate: new Date("2025-03-01"),
  endDate: new Date("2025-06-10T12:00:00Z"),
  bonusOverride: 10_000,
};

function renderFor(bonusMonth: number | null) {
  const bonusDayOfMonth = bonusMonth == null ? null : 15;
  const paycheck = calculatePaycheck({
    ...ending,
    bonusMonth,
    bonusDayOfMonth,
  });
  render(
    <BonusSection
      paycheck={paycheck}
      fullFormulaBonusEstimate={paycheck.bonusEstimate}
      job={{ bonusMonth, bonusDayOfMonth }}
      resolvedBonusTerms={{
        bonusPercent: 0.1,
        bonusMultiplier: 1,
        monthsInBonusYear: 12,
        bonusOverride: 10_000,
      }}
      bonusAccounts={[]}
      bonusDestination="budget"
      onUpdateJob={() => {}}
      readOnly
    />,
  );
}

describe("BonusSection, a job ending this year", () => {
  it("a bonus dated after the last day: no pay period, no gross", () => {
    renderFor(12);
    expect(
      screen.getByText("After the job's last day: not paid this year"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pay period/)).not.toBeInTheDocument();
    expect(screen.queryByText("Gross")).not.toBeInTheDocument();
  });

  it("an undated bonus: not counted for want of a date, not called after the last day", () => {
    renderFor(null);
    expect(
      screen.getByText("No date, and the job ends this year: not counted"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/After the job's last day/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Gross")).not.toBeInTheDocument();
  });

  it("a bonus dated before the last day: its pay period and gross", () => {
    renderFor(3);
    expect(screen.getByText(/Pay period \d+ of 26/)).toBeInTheDocument();
    expect(screen.getByText("Gross")).toBeInTheDocument();
  });
});
