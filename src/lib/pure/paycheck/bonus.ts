/** The bonus check: federal withheld at the IRS supplemental flat rate (from
 *  input), less what each account takes from bonus checks (`fromBonus`). */
import type {
  PaycheckInput,
  BonusEstimate,
  DeductionLine,
} from "./paycheck.types";
import { roundToCents, sumBy } from "../../utils/math";
import { MS_PER_DAY } from "../../constants";
import { getPeriodsPerYear } from "../../config/pay-periods";
import { isPreTax, regularFicaExemptPerPeriod } from "./taxable-wages";
import { alignPaydayOnOrAfter } from "./pay-periods-in-year";

/**
 * Whether a contribution account is paid through payroll: its own
 * `isPayrollDeducted`, or — when that's unset — whether it belongs to a job.
 * The one definition; everything that asks uses it.
 */
export function isPaidThroughPayroll(account: {
  isPayrollDeducted?: boolean | null;
  jobId: number | null;
}): boolean {
  return account.isPayrollDeducted ?? account.jobId !== null;
}

/** takesFromBonusCheck for a contribution account row (payroll resolved
 *  with isPaidThroughPayroll). */
export function rowTakesFromBonusCheck(row: {
  isPayrollDeducted?: boolean | null;
  jobId: number | null;
  fromBonus?: boolean | null;
}): boolean {
  return takesFromBonusCheck({
    isPayrollDeducted: isPaidThroughPayroll(row),
    fromBonus: row.fromBonus === true,
  });
}

/**
 * Whether the bonus check takes this account: paid through payroll and set
 * to be taken from bonus checks (`fromBonus`). The one rule — the bonus-check
 * amount, the employer match's pay and every label use it.
 */
export function takesFromBonusCheck(account: {
  isPayrollDeducted: boolean;
  fromBonus: boolean | undefined;
}): boolean {
  return account.isPayrollDeducted && account.fromBonus === true;
}

/**
 * What a bonus check takes for one account: percent-of-pay its rate of the bonus,
 * fixed-amount its per-period dollars; nothing if not payroll or not `fromBonus`.
 * The one rule for bonus-check contributions (paycheck, summary, projection).
 */
export function bonusCheckContribution(
  account: {
    isPayrollDeducted: boolean;
    /** Also taken from bonus checks. */
    fromBonus: boolean | undefined;
    rateOfGross: number | null;
    perPeriodContribution: number;
  },
  bonusGross: number,
): number {
  if (!takesFromBonusCheck(account) || bonusGross <= 0) return 0;
  return account.rateOfGross !== null
    ? roundToCents(account.rateOfGross * bonusGross)
    : account.perPeriodContribution;
}

/**
 * Net bonus pay: gross = salary × bonus% × (months in bonus year / 12); federal
 * withholding at the supplemental flat rate, not the marginal rate. Contributions
 * come out per bonusCheckContribution.
 */
export function calculateBonus(
  input: PaycheckInput,
  _marginalRate: number,
  /** Regular pay's FICA wages for the year — what has used the SS wage base before the bonus. */
  regularFicaWagesAnnual: number,
): BonusEstimate {
  if (input.bonusPercent <= 0 && input.bonusOverride === null) {
    return {
      bonusGross: 0,
      bonusNet: 0,
      bonusFederalWithholding: 0,
      bonusFica: 0,
      bonusContributions: 0,
      bonusFicaWages: 0,
      bonusFederalTaxable: 0,
      bonusLines: [],
    };
  }

  // If bonus_override is set on the job, use that value directly as gross bonus.
  // Otherwise: salary × bonus_percent × bonus_multiplier × (months_in_bonus_year / 12).
  const bonusGross =
    input.bonusOverride !== null
      ? roundToCents(input.bonusOverride)
      : roundToCents(
          input.annualSalary *
            input.bonusPercent *
            input.bonusMultiplier *
            (input.monthsInBonusYear / 12),
        );

  // The contributions the bonus check takes (accounts set to be taken from
  // bonus checks) — percent-of-salary ones scale against bonusGross,
  // fixed-amount ones take their regular per-period dollars.
  const bonusLines: DeductionLine[] = input.contributionAccounts.flatMap(
    (ca) => {
      const amount = bonusCheckContribution(ca, bonusGross);
      return amount > 0
        ? [
            {
              name: ca.name,
              amount,
              taxTreatment: ca.taxTreatment,
              ficaExempt: false,
            },
          ]
        : [];
    },
  );
  // The supplemental flat rate (tax data — typically 22%) applies to the
  // bonus's federal taxable wages: gross less the pre-tax money it takes.
  const bonusFederalTaxable = roundToCents(
    Math.max(
      0,
      bonusGross -
        sumBy(
          bonusLines.filter((l) => isPreTax(l.taxTreatment)),
          (l) => l.amount,
        ),
    ),
  );
  const bonusFederalWithholding = roundToCents(
    bonusFederalTaxable * input.supplementalTaxRate,
  );

  // FICA wages: the bonus less FICA-exempt contributions it takes (HSA, within the
  // cap regular checks left). SS only on the wage-base room regular wages leave.
  const ssRate = input.taxBrackets.socialSecurityRate;
  const medRate = input.taxBrackets.medicareRate;
  const ssWageBase = input.taxBrackets.socialSecurityWageBase;
  const periodsPerYear = getPeriodsPerYear(input.payPeriod);
  const bonusFicaExempt = sumBy(input.contributionAccounts, (ca) => {
    const cap = ca.ficaExemptAnnualCap;
    if (cap === null) return 0;
    if (!isPreTax(ca.taxTreatment)) return 0;
    const capLeft =
      cap - regularFicaExemptPerPeriod(ca, periodsPerYear) * periodsPerYear;
    return Math.min(
      bonusCheckContribution(ca, bonusGross),
      Math.max(0, capLeft),
    );
  });
  const bonusFicaWages = Math.max(0, bonusGross - bonusFicaExempt);
  const ssCapRoom = Math.max(
    0,
    ssWageBase - Math.min(regularFicaWagesAnnual, ssWageBase),
  );
  const bonusSsTaxable = Math.min(bonusFicaWages, ssCapRoom);
  const bonusFicaSS = roundToCents(bonusSsTaxable * ssRate);
  const bonusFicaMed = roundToCents(bonusFicaWages * medRate);
  const bonusFica = bonusFicaSS + bonusFicaMed;

  const bonusContributions = sumBy(bonusLines, (l) => l.amount);

  const bonusNet = roundToCents(
    bonusGross - bonusFederalWithholding - bonusFica - bonusContributions,
  );

  return {
    bonusGross,
    bonusNet,
    bonusFederalWithholding,
    bonusFica,
    bonusContributions,
    bonusFicaWages,
    bonusFederalTaxable,
    bonusLines,
  };
}

/**
 * Finds the pay period that contains the bonus pay date.
 * When bonusDayOfMonth is provided, matches the specific date within the month.
 * Otherwise falls back to the first pay period of the given month.
 */
export function findBonusPeriod(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: Date,
  bonusMonth: number,
  bonusDayOfMonth: number | null,
): number {
  const year = asOfDate.getFullYear();
  const msPerDay = MS_PER_DAY;
  const targetMonth = bonusMonth - 1; // 0-indexed
  // Clamp day to valid range for target month
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  const targetDay =
    bonusDayOfMonth != null ? Math.min(bonusDayOfMonth, lastDay) : null;
  const bonusDate =
    targetDay != null ? new Date(Date.UTC(year, targetMonth, targetDay)) : null;

  if (payPeriod === "biweekly" || payPeriod === "weekly") {
    const interval = payPeriod === "biweekly" ? 14 : 7;
    const jan1 = new Date(Date.UTC(year, 0, 1));
    let payday = alignPaydayOnOrAfter(anchorPayDate, jan1, interval);

    let periodNum = 0;
    const december31 = new Date(Date.UTC(year, 11, 31));
    while (payday <= december31) {
      periodNum++;
      if (bonusDate) {
        // Find the period whose window contains the bonus date
        const nextPayday = new Date(payday.getTime() + interval * msPerDay);
        if (bonusDate >= payday && bonusDate < nextPayday) return periodNum;
      } else {
        if (payday.getUTCMonth() === targetMonth) return periodNum;
      }
      payday = new Date(payday.getTime() + interval * msPerDay);
    }
    return periodNum; // fallback to last period
  }

  if (payPeriod === "semimonthly") {
    // Periods: 1st and 16th of each month
    if (targetDay != null && targetDay >= 16) {
      return targetMonth * 2 + 2; // second pay period of the month
    }
    return targetMonth * 2 + 1; // first pay period of the month
  }

  if (payPeriod === "monthly") {
    return targetMonth + 1;
  }

  return 1;
}
