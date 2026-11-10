/**
 * Maps already-resolved values (salary, bonus terms, contributions, deductions, brackets, limits)
 * onto PaycheckInput. Callers resolve through their own pipelines (computePaycheckSummary with
 * What-If edits; computeJobNetPayPerCheck) and share only this construction tail.
 */
import type { PaycheckInput } from "@/lib/pure/paycheck/paycheck.types";
import type {
  BonusTerms,
  DeductionLine,
  EarningLine,
  TaxBracketInput,
  ContributionAccountInput,
} from "@/lib/pure/paycheck/paycheck.types";
import { toNumber } from "@/lib/utils/numbers";
import { requireLimit } from "@/lib/pure/tax/tax-limits";

/**
 * Fields from the resolved Salary Profile entry (`startDate` from the job). Callers pass only a
 * complete entry, so `undefined` means a broken upstream contract; `null` is a real value
 * (`anchorPayDate: null` = no anchor, use start date).
 */
export interface JobForPaycheckInput {
  payPeriod: PaycheckInput["payPeriod"] | undefined;
  payWeek: PaycheckInput["payWeek"] | undefined;
  anchorPayDate: string | Date | null | undefined;
  startDate: string | Date;
  bonusMonth: number | null | undefined;
  bonusDayOfMonth: number | null | undefined;
  additionalFedWithholding: string | number | null | undefined;
}

export interface ResolvedPaycheckInputs {
  salary: number;
  bonusTerms: BonusTerms;
  /** This year's pinned actual bonus, if any — null means "use the formula." */
  bonusOverride: number | null;
  contributionAccounts: ContributionAccountInput[];
  deductions: DeductionLine[];
  /** Other pay / taxable benefits per check — required so no caller can
   *  quietly leave them out. */
  earnings: EarningLine[];
  taxBrackets: TaxBracketInput;
  limitsMap: Map<string, number>;
  limitsRecord: Record<string, number>;
  asOfDate: Date;
}

/**
 * Maps resolved job/salary/contribution/deduction values onto a PaycheckInput. A null
 * `bonusMultiplier` means unset and reads as 1×, not 0× (as in computeBonusGross).
 */
export function buildPaycheckInputForJob(
  job: JobForPaycheckInput,
  resolved: ResolvedPaycheckInputs,
): PaycheckInput {
  return {
    annualSalary: resolved.salary,
    payPeriod: job.payPeriod!,
    payWeek: job.payWeek!,
    // `null` means "no anchor, use start date"; `undefined` can't reach here (see
    // JobForPaycheckInput).
    anchorPayDate: new Date(job.anchorPayDate ?? job.startDate),
    supplementalTaxRate: requireLimit(
      resolved.limitsMap,
      "supplemental_tax_rate",
    ),
    additionalFedWithholding: toNumber(
      job.additionalFedWithholding == null
        ? null
        : String(job.additionalFedWithholding),
    ),
    contributionAccounts: resolved.contributionAccounts,
    deductions: resolved.deductions,
    earnings: resolved.earnings,
    taxBrackets: resolved.taxBrackets,
    limits: resolved.limitsRecord,
    bonusPercent: toNumber(resolved.bonusTerms.bonusPercent),
    bonusMultiplier:
      resolved.bonusTerms.bonusMultiplier === null
        ? 1
        : toNumber(resolved.bonusTerms.bonusMultiplier),
    bonusOverride: resolved.bonusOverride,
    monthsInBonusYear: resolved.bonusTerms.monthsInBonusYear ?? 12,
    bonusMonth: job.bonusMonth ?? null,
    bonusDayOfMonth: job.bonusDayOfMonth ?? null,
    asOfDate: resolved.asOfDate,
    startDate: new Date(job.startDate),
  };
}
