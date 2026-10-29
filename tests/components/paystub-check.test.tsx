/**
 * "Check against a pay stub" — Ledgr's side of one check (ledgrCheckFor)
 * and the panel that compares a stub with it. Fictional household
 * (the paycheck calculator fixtures).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PaystubCheck } from "@/components/paycheck/paystub-check";
import { calculatePaycheck } from "@/lib/calculators/paycheck";
import { ledgrCheckFor, type FicaRates } from "@/lib/pure/paystub-check";
import { PERSON_A_PAYCHECK_INPUT } from "../calculators/fixtures";

// HelpTip's Radix Tooltip needs a TooltipProvider ancestor the page supplies.
vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

const tb = PERSON_A_PAYCHECK_INPUT.taxBrackets;
const rates: FicaRates = {
  socialSecurity: tb.socialSecurityRate,
  medicare: tb.medicareRate,
  socialSecurityWageBase: tb.socialSecurityWageBase,
  medicareWithholdingThreshold: tb.medicareAdditionalThreshold,
  additionalMedicare: tb.medicareAdditionalRate,
};
const paycheck = calculatePaycheck(PERSON_A_PAYCHECK_INPUT);
// The panel compares this year's checks.
const Y = new Date().getFullYear();
// $400,000 a year passes the Social Security wage base and the Additional
// Medicare threshold partway through the year.
const highPaycheck = calculatePaycheck({
  ...PERSON_A_PAYCHECK_INPUT,
  annualSalary: 400_000,
});

describe("ledgrCheckFor", () => {
  it("takes the check's wages and lines from the paycheck", () => {
    const c = ledgrCheckFor(paycheck, rates, 5);
    expect(c.federalTaxableGross).toBe(paycheck.federalTaxableGross);
    expect(c.ficaWages).toBe(paycheck.ficaWages);
    expect(c.ssStopped).toBe(false);
    expect(c.additionalMedicare).toBe(false);
    expect(c.lines).toHaveLength(
      paycheck.preTaxDeductions.length + paycheck.postTaxDeductions.length,
    );
  });

  it("past the wage base and the Additional Medicare threshold late in a high-pay year", () => {
    expect(ledgrCheckFor(highPaycheck, rates, 2).ssStopped).toBe(false);
    expect(ledgrCheckFor(highPaycheck, rates, 2).additionalMedicare).toBe(
      false,
    );
    const late = ledgrCheckFor(highPaycheck, rates, 24);
    expect(late.ssStopped).toBe(true);
    expect(late.additionalMedicare).toBe(true);
  });

  it("net pay is the check's own — more once Social Security has stopped", () => {
    const early = ledgrCheckFor(highPaycheck, rates, 2);
    const late = ledgrCheckFor(highPaycheck, rates, 24);
    expect(early.netPay).toBe(highPaycheck.yearSchedule[1]!.netPay);
    expect(late.netPay).toBe(highPaycheck.yearSchedule[23]!.netPay);
    expect(late.netPay).toBeGreaterThan(early.netPay);
  });

  it("the bonus counts toward the Additional Medicare threshold once paid", () => {
    // $195,000 + a $19,500 bonus in March: past $200,000 only with the bonus.
    const p = calculatePaycheck({
      ...PERSON_A_PAYCHECK_INPUT,
      annualSalary: 195_000,
      bonusMonth: 3,
      bonusDayOfMonth: 15,
    });
    const last = p.periodsPerYear;
    expect(p.bonusPeriod).not.toBeNull();
    expect(ledgrCheckFor(p, rates, last).additionalMedicare).toBe(true);
    expect(
      ledgrCheckFor({ ...p, bonusPeriod: null }, rates, last)
        .additionalMedicare,
    ).toBe(false);
  });
});

describe("PaystubCheck", () => {
  const open = () => {
    render(
      <PaystubCheck
        paycheck={paycheck}
        rates={rates}
        payPeriod="biweekly"
        anchor={`${Y}-01-02`}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pay stub/i }));
  };
  const type = (label: string, value: number) =>
    fireEvent.change(screen.getByLabelText(`Stub ${label}`), {
      target: { value: String(value) },
    });

  it("is closed until opened, then asks for a figure", () => {
    render(
      <PaystubCheck
        paycheck={paycheck}
        rates={rates}
        payPeriod="biweekly"
        anchor={`${Y}-01-02`}
      />,
    );
    expect(screen.queryByLabelText("Stub Gross pay")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /pay stub/i }));
    expect(screen.getByText(/Enter a figure/)).toBeTruthy();
  });

  it("a stub that matches says so", () => {
    open();
    type("Gross pay", Math.round(paycheck.gross * 100) / 100);
    type("Net pay", Math.round(paycheck.netPay * 100) / 100);
    expect(screen.getByText("Matches your stub.")).toBeTruthy();
  });

  it("names the deduction line a federal-taxable gap points to", () => {
    open();
    const std = paycheck.preTaxDeductions.find((d) => d.name === "STD")!;
    type("Federal taxable wages", paycheck.federalTaxableGross + std.amount);
    expect(screen.getByText(/STD looks after-tax/)).toBeTruthy();
    expect(screen.queryByText("Matches your stub.")).toBeNull();
  });

  it("the pay date picks the check", () => {
    open();
    fireEvent.change(screen.getByLabelText("Stub pay date"), {
      target: { value: `${Y}-01-30` },
    });
    expect(screen.getByText(/Check 3 of 26/)).toBeTruthy();
  });

  it("a stub from another year isn't compared", () => {
    open();
    fireEvent.change(screen.getByLabelText("Stub pay date"), {
      target: { value: `${Y - 1}-12-26` },
    });
    type("Gross pay", 1);
    expect(screen.getByText(/enter a stub from/)).toBeTruthy();
    expect(screen.queryByText("Off")).toBeNull();
  });
});
