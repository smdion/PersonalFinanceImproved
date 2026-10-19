/**
 * Household annual income — the one yearly earnings model.
 *
 * Every this-year income figure (the annual tax, the Income card, Living
 * Costs, MAGI) reads computeAnnualEarnings / sumHouseholdIncome instead of
 * re-summing salary, so a bonus or a FICA-exempt contribution can't be in
 * one figure and missing from another.
 *
 * Built from the paycheck calculator's own result: the RESOLVED bonus
 * (`bonusEstimate` — the set bonus if there is one, else the formula), the
 * per-check FICA wages, and each contribution account's yearly amount
 * including what the bonus check takes (bonusCheckContribution — the same
 * rule as annualContributionWithBonus).
 */
import type {
  ContributionAccountInput,
  DeductionLine,
  PaycheckResult,
} from "@/lib/calculators/types";
import { bonusCheckContribution, isPreTax } from "@/lib/calculators/paycheck";
import { roundToCents, sumBy } from "@/lib/utils/math";
import { isHsaTreatment } from "@/lib/config/account-types";

export type AnnualEarnings = {
  salary: number;
  /** The resolved bonus: the set (actual) bonus if there is one, else the formula. */
  bonus: number;
  /** salary + bonus. */
  gross: number;
  /** Comes out before federal income tax: pre-tax payroll contributions
   *  (regular and bonus checks) and pre-tax deductions. */
  preTaxFederal: number;
  /** Social Security / Medicare wages: gross less Section 125 deductions
   *  and FICA-exempt payroll contributions (within their cap). */
  ficaWages: number;
  /** Take-home from the regular checks for the year. */
  netRegular: number;
  /** Take-home from the bonus check. */
  netBonus: number;
  /** HSA money paid in outside payroll — deducted above the line (Form 8889),
   *  so it lowers AGI but isn't on the paycheck. */
  hsaOutsidePayroll: number;
};

export function computeAnnualEarnings(args: {
  salary: number;
  periodsPerYear: number;
  paycheck: PaycheckResult;
  contributionAccounts: ContributionAccountInput[];
  deductions: DeductionLine[];
  /** Whether the bonus check takes payroll contributions (PaycheckInput.includeContribInBonus). */
  includeContribInBonus: boolean;
}): AnnualEarnings {
  const { salary, periodsPerYear, paycheck } = args;
  const bonus = paycheck.bonusEstimate.bonusGross;

  const preTaxContributions = sumBy(
    args.contributionAccounts.filter(
      (ca) => ca.isPayrollDeducted && isPreTax(ca.taxTreatment),
    ),
    (ca) =>
      ca.annualContribution +
      (args.includeContribInBonus ? bonusCheckContribution(ca, bonus) : 0),
  );
  const preTaxDeductions =
    sumBy(
      args.deductions.filter((d) => isPreTax(d.taxTreatment)),
      (d) => d.amount,
    ) * periodsPerYear;

  // FICA-exempt money on the regular checks is gross − FICA wages per check;
  // the bonus's FICA wages already net out what its check exempts.
  const regularFicaExempt =
    (paycheck.gross - paycheck.ficaWages) * periodsPerYear;

  return {
    salary,
    bonus,
    gross: roundToCents(salary + bonus),
    preTaxFederal: roundToCents(preTaxContributions + preTaxDeductions),
    ficaWages: roundToCents(
      salary - regularFicaExempt + paycheck.bonusEstimate.bonusFicaWages,
    ),
    netRegular: roundToCents(paycheck.netPay * periodsPerYear),
    netBonus: paycheck.bonusEstimate.bonusNet,
    hsaOutsidePayroll: roundToCents(
      sumBy(
        args.contributionAccounts.filter(
          (ca) => !ca.isPayrollDeducted && isHsaTreatment(ca.taxTreatment),
        ),
        (ca) => ca.annualContribution,
      ),
    ),
  };
}

/** The household's earnings — the per-person figures summed. */
export function sumHouseholdIncome(people: AnnualEarnings[]): AnnualEarnings {
  const total = (pick: (e: AnnualEarnings) => number) =>
    roundToCents(sumBy(people, pick));
  return {
    salary: total((e) => e.salary),
    bonus: total((e) => e.bonus),
    gross: total((e) => e.gross),
    preTaxFederal: total((e) => e.preTaxFederal),
    ficaWages: total((e) => e.ficaWages),
    netRegular: total((e) => e.netRegular),
    netBonus: total((e) => e.netBonus),
    hsaOutsidePayroll: total((e) => e.hsaOutsidePayroll),
  };
}
