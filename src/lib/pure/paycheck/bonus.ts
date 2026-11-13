/** The bonus check: federal withheld at the IRS supplemental flat rate (from
 *  input), less what each account takes from bonus checks (`fromBonus`). */
import type {
  PaycheckInput,
  BonusEstimate,
  DeductionLine,
} from "./paycheck.types";
import { roundToCents, sumBy } from "../../utils/math";
import { yearPaydays } from "./year-paydays";
import { isPreTax, regularFicaExemptPerPeriod } from "./taxable-wages";
import { bonusCheckNet } from "./year-totals";
import { additionalMedicareWithheld } from "./additional-medicare";

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

/** The bonus estimate, as if paid after the regular checks: federal at the supplemental flat
 *  rate, contributions per bonusCheckContribution, take-home per bonusCheckNet. */
export function calculateBonus(
  input: PaycheckInput,
  _marginalRate: number,
  /** Regular pay's FICA wages for the year — what has used the SS wage base before the bonus. */
  regularFicaWagesAnnual: number,
): BonusEstimate {
  // The set bonus, else salary × bonus% × multiplier × (months in bonus year / 12);
  // no bonus percent and no set amount: $0.
  const bonusGross =
    input.bonusOverride !== null
      ? roundToCents(input.bonusOverride)
      : input.bonusPercent > 0
        ? roundToCents(
            input.annualSalary *
              input.bonusPercent *
              input.bonusMultiplier *
              (input.monthsInBonusYear / 12),
          )
        : 0;

  // What the bonus check takes, per bonusCheckContribution.
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
  const paydays = yearPaydays(input);
  const bonusFicaExempt = sumBy(input.contributionAccounts, (ca) => {
    const cap = ca.ficaExemptAnnualCap;
    if (cap === null) return 0;
    if (!isPreTax(ca.taxTreatment)) return 0;
    const covered = ca.coveredChecks ?? paydays; // the regular checks it covers
    const capLeft = cap - regularFicaExemptPerPeriod(ca, paydays) * covered;
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
  // Additional Medicare on the part past this employer's threshold, after regular pay.
  const bonusAdditionalMedicare = roundToCents(
    additionalMedicareWithheld(
      input.taxBrackets,
      bonusFicaWages,
      regularFicaWagesAnnual + bonusFicaWages,
    ),
  );
  const bonusFica = bonusFicaSS + bonusFicaMed + bonusAdditionalMedicare;

  const bonusContributions = sumBy(bonusLines, (l) => l.amount);

  return {
    bonusGross,
    bonusNet: bonusCheckNet({
      gross: bonusGross,
      federal: bonusFederalWithholding,
      fica: bonusFica,
      contributions: bonusContributions,
    }),
    bonusFederalWithholding,
    bonusFica,
    bonusContributions,
    bonusFicaWages,
    bonusFederalTaxable,
    bonusLines,
  };
}
