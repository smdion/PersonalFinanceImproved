/**
 * Household annual income — the one yearly earnings model.
 *
 * Every this-year income figure (the annual tax, the Income card, Living
 * Costs, MAGI) reads computeAnnualEarnings / sumHouseholdIncome instead of
 * re-summing salary, so a bonus or a FICA-exempt contribution can't be in
 * one figure and missing from another.
 *
 * A job pays only the checks inside the year (`checks` — fewer for one
 * started or ended this year); every job a person had this year is summed
 * (the paycheck router). Built from the paycheck calculator's own result: the RESOLVED bonus
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
import type { BonusDestination } from "@/lib/config/enum-values";

type AnnualEarnings = {
  salary: number;
  /** The resolved bonus: the set (actual) bonus if there is one, else the formula. */
  bonus: number;
  /** Cash pay: salary + bonus + other cash pay. */
  gross: number;
  /** Other cash pay on the checks for the year (stipends etc.), in gross. */
  otherCashPay: number;
  /** Taxable benefits never paid (imputed income) for the year — taxed,
   *  not in gross or take-home. */
  imputedIncome: number;
  /** Federal income-tax wages (≈ W-2 box 1): pay that's federally taxable,
   *  incl. imputed income, less pre-tax money. The tax and AGI read this. */
  federalWages: number;
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
  /** The checks this job pays inside the year — fewer for a job started
   *  or ended this year. Default: every check (a full year). */
  checks?: number;
  /** The bonus is paid this year by this job. Default: yes. */
  bonusPaid?: boolean;
}): AnnualEarnings {
  const { periodsPerYear, paycheck } = args;
  const checks = args.checks ?? periodsPerYear;
  const share = periodsPerYear > 0 ? checks / periodsPerYear : 0;
  const salary = args.salary * share;
  const bonusPaid = args.bonusPaid ?? true;
  const bonusEstimate = paycheck.bonusEstimate;
  const bonus = bonusPaid ? bonusEstimate.bonusGross : 0;

  const preTaxContributions = sumBy(
    args.contributionAccounts.filter(
      (ca) => ca.isPayrollDeducted && isPreTax(ca.taxTreatment),
    ),
    (ca) => ca.annualContribution * share + bonusCheckContribution(ca, bonus),
  );
  const preTaxDeductions =
    sumBy(
      args.deductions.filter((d) => isPreTax(d.taxTreatment)),
      (d) => d.amount,
    ) * checks;

  // Other pay on the checks, by its own tax flags.
  const lines = paycheck.earnings ?? [];
  const perYear = (pick: (e: (typeof lines)[number]) => boolean) =>
    sumBy(lines.filter(pick), (e) => e.amount) * checks;
  const otherCashPay = perYear((e) => e.isCash);
  const imputedIncome = perYear((e) => !e.isCash);
  const otherFederalTaxable = perYear((e) => e.federalTaxable);
  const preTaxFederal = preTaxContributions + preTaxDeductions;

  return {
    salary,
    bonus,
    gross: roundToCents(salary + bonus + otherCashPay),
    otherCashPay: roundToCents(otherCashPay),
    imputedIncome: roundToCents(imputedIncome),
    federalWages: roundToCents(
      salary + bonus + otherFederalTaxable - preTaxFederal,
    ),
    preTaxFederal: roundToCents(preTaxFederal),
    // The checks' own FICA wages (salary, other pay, less exempt money)
    // plus the bonus check's — built from explicit parts, never from salary.
    ficaWages: roundToCents(
      paycheck.ficaWages * checks +
        (bonusPaid ? bonusEstimate.bonusFicaWages : 0),
    ),
    // The year schedule's own checks (Social Security stops at the wage
    // base, Additional Medicare starts above its threshold) — this job's,
    // from its first check this year.
    netRegular: roundToCents(
      sumBy(
        paycheck.yearSchedule.slice(
          paycheck.periodsBeforeStart,
          paycheck.periodsBeforeStart + checks,
        ),
        (p) => p.netPay,
      ),
    ),
    netBonus: bonusPaid ? bonusEstimate.bonusNet : 0,
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
    otherCashPay: total((e) => e.otherCashPay),
    imputedIncome: total((e) => e.imputedIncome),
    federalWages: total((e) => e.federalWages),
    preTaxFederal: total((e) => e.preTaxFederal),
    ficaWages: total((e) => e.ficaWages),
    netRegular: total((e) => e.netRegular),
    netBonus: total((e) => e.netBonus),
    hsaOutsidePayroll: total((e) => e.hsaOutsidePayroll),
  };
}

/** Bonus take-home set aside as extra spending (outside the budget). Its
 *  taxes and bonus-check contributions are already counted elsewhere. */
export function bonusSpendingNet(
  people: readonly { netBonus: number; bonusDestination: BonusDestination }[],
): number {
  return roundToCents(
    sumBy(
      people.filter((p) => p.bonusDestination === "spending"),
      (p) => p.netBonus,
    ),
  );
}
