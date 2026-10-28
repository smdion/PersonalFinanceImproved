/**
 * computeAnnualEarnings — the one yearly earnings model, built from the
 * paycheck calculator's result (fictional households).
 */
import { describe, it, expect } from "vitest";
import { calculatePaycheck } from "@/lib/calculators/paycheck";
import {
  bonusSpendingNet,
  computeAnnualEarnings,
  sumHouseholdIncome,
} from "@/lib/pure/household-income";
import type {
  ContributionAccountInput,
  PaycheckInput,
} from "@/lib/calculators/types";
import { PERSON_A_PAYCHECK_INPUT } from "../calculators/fixtures";

const account = (
  over: Partial<ContributionAccountInput>,
): ContributionAccountInput => ({
  name: "401k",
  annualContribution: 0,
  perPeriodContribution: 0,
  rateOfGross: null,
  taxTreatment: "pre_tax",
  isPayrollDeducted: true,
  fromBonus: false,
  group: "retirement",
  employerMatch: 0,
  employerMatchTaxTreatment: "pre_tax",
  ficaExemptAnnualCap: null,
  ...over,
});

function earningsFor(over: Partial<PaycheckInput>) {
  const input: PaycheckInput = {
    ...PERSON_A_PAYCHECK_INPUT,
    annualSalary: 104_000,
    deductions: [],
    contributionAccounts: [],
    bonusPercent: 0,
    bonusOverride: null,
    ...over,
  };
  const paycheck = calculatePaycheck(input);
  return {
    paycheck,
    earnings: computeAnnualEarnings({
      salary: input.annualSalary,
      periodsPerYear: paycheck.periodsPerYear,
      paycheck,
      contributionAccounts: input.contributionAccounts,
      deductions: input.deductions,
    }),
  };
}

// 10% traditional 401(k), $4,000/yr payroll HSA (exempt in full), a $50
// Section 125 deduction and a 6% Roth 401(k).
const trad = account({
  name: "Traditional 401k",
  annualContribution: 10_400,
  perPeriodContribution: 400,
  rateOfGross: 0.1,
});
const roth = account({
  name: "Roth 401k",
  annualContribution: 6_240,
  perPeriodContribution: 240,
  rateOfGross: 0.06,
  taxTreatment: "tax_free",
});
const hsa = account({
  name: "HSA",
  annualContribution: 4_160,
  perPeriodContribution: 160,
  taxTreatment: "hsa",
  group: "portfolio",
  ficaExemptAnnualCap: Infinity,
});
/** The same accounts, each also taken from bonus checks. */
const fromBonus = (accounts: ContributionAccountInput[]) =>
  accounts.map((a) => ({ ...a, fromBonus: true }));
const medical = {
  name: "Medical",
  amount: 50,
  taxTreatment: "pre_tax" as const,
  ficaExempt: true,
};

describe("computeAnnualEarnings", () => {
  it("salary only: gross = salary, pre-tax and FICA wages from the paycheck's rules", () => {
    const { earnings } = earningsFor({
      contributionAccounts: [trad, roth, hsa],
      deductions: [medical],
    });
    expect(earnings.gross).toBe(104_000);
    expect(earnings.bonus).toBe(0);
    // Traditional + HSA + Section 125; Roth is after-tax.
    expect(earnings.preTaxFederal).toBeCloseTo(10_400 + 4_160 + 50 * 26, 2);
    // FICA wages: less Section 125 and the payroll HSA, not the 401(k).
    expect(earnings.ficaWages).toBeCloseTo(104_000 - 50 * 26 - 4_160, 0);
  });

  it("a set bonus is the bonus, and the bonus check's contributions count when it takes them", () => {
    const { earnings } = earningsFor({
      contributionAccounts: fromBonus([trad, roth, hsa]),
      bonusOverride: 10_000,
    });
    expect(earnings.bonus).toBe(10_000);
    expect(earnings.gross).toBe(114_000);
    // Bonus check: 10% of the bonus to the traditional 401(k) and the HSA's
    // fixed $160 (percent accounts at their rate, fixed ones once more).
    expect(earnings.preTaxFederal).toBeCloseTo(10_400 + 4_160 + 1_000 + 160, 2);
    expect(earnings.ficaWages).toBeCloseTo(104_000 - 4_160 + 10_000 - 160, 0);
  });

  it("without contributions from the bonus check, the bonus is all wages", () => {
    const { earnings } = earningsFor({
      contributionAccounts: [trad, hsa],
      bonusOverride: 10_000,
    });
    expect(earnings.preTaxFederal).toBeCloseTo(10_400 + 4_160, 2);
    expect(earnings.ficaWages).toBeCloseTo(104_000 - 4_160 + 10_000, 0);
  });

  it("the formula bonus when no bonus is set", () => {
    const { earnings } = earningsFor({ bonusPercent: 0.05 });
    expect(earnings.bonus).toBeCloseTo(5_200, 2);
  });

  it("FICA wages = per-check FICA wages × checks + the bonus's FICA wages (drift guard)", () => {
    const { paycheck, earnings } = earningsFor({
      contributionAccounts: fromBonus([trad, hsa]),
      deductions: [medical],
      bonusOverride: 8_000,
    });
    expect(earnings.ficaWages).toBeCloseTo(
      paycheck.ficaWages * 26 + paycheck.bonusEstimate.bonusFicaWages,
      0,
    );
    expect(earnings.netRegular).toBeCloseTo(paycheck.netPay * 26, 2);
    expect(earnings.netBonus).toBe(paycheck.bonusEstimate.bonusNet);
  });

  it("non-payroll money is neither pre-tax on the paycheck nor FICA-exempt", () => {
    const { earnings } = earningsFor({
      contributionAccounts: [{ ...hsa, isPayrollDeducted: false }],
    });
    expect(earnings.preTaxFederal).toBe(0);
    expect(earnings.ficaWages).toBeCloseTo(104_000, 0);
  });
});

describe("sumHouseholdIncome", () => {
  it("adds each person's figures", () => {
    const a = earningsFor({ bonusOverride: 5_000 }).earnings;
    const b = earningsFor({ annualSalary: 52_000 }).earnings;
    const h = sumHouseholdIncome([a, b]);
    expect(h.gross).toBeCloseTo(a.gross + b.gross, 2);
    expect(h.bonus).toBe(5_000);
    expect(h.ficaWages).toBeCloseTo(a.ficaWages + b.ficaWages, 2);
  });
});

describe("bonus destinations", () => {
  it("only bonuses set to extra spending count", () => {
    expect(
      bonusSpendingNet([
        { netBonus: 6900.2, bonusDestination: "budget" },
        { netBonus: 11857.22, bonusDestination: "spending" },
      ]),
    ).toBe(11857.22);
    expect(
      bonusSpendingNet([{ netBonus: 6900.2, bonusDestination: "budget" }]),
    ).toBe(0);
  });
});

describe("computeAnnualEarnings: part of a year", () => {
  it("counts only the checks a job pays inside the year, and a bonus it pays", () => {
    const input: PaycheckInput = {
      ...PERSON_A_PAYCHECK_INPUT,
      bonusOverride: 5_000,
    };
    const paycheck = calculatePaycheck(input);
    const args = {
      salary: input.annualSalary,
      periodsPerYear: 26,
      paycheck,
      contributionAccounts: input.contributionAccounts,
      deductions: input.deductions,
    };
    const full = computeAnnualEarnings(args);
    const half = computeAnnualEarnings({
      ...args,
      checks: 13,
      bonusPaid: false,
    });
    expect(half.salary).toBeCloseTo(full.salary / 2, 2);
    expect(half.bonus).toBe(0);
    expect(half.gross).toBeCloseTo(full.salary / 2 + full.otherCashPay / 2, 2);
    expect(half.ficaWages).toBeCloseTo(paycheck.ficaWages * 13, 2);
    expect(half.netBonus).toBe(0);
    // Default: the whole year, bonus included.
    expect(full.bonus).toBe(5_000);
  });
});
