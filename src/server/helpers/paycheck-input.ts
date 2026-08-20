/**
 * Shared tail of "build a PaycheckInput" — the mechanical field mapping
 * from already-resolved values (salary, bonus terms, contribution accounts,
 * deductions, tax brackets, limits) into the calculator's input shape.
 *
 * Consolidated per audit Batch 9 Finding 3, scoped deliberately narrow:
 * this covers ONLY the object-construction tail, not the upstream
 * resolution logic. paycheck.ts's router and savings.ts's
 * computeJobNetPayPerCheck resolve salary/contributions/deductions through
 * genuinely different pipelines — the router applies Plan/session
 * overrides, What-If sandbox edits, and bonus-term/deduction overrides;
 * computeJobNetPayPerCheck deliberately does NOT (its result is persisted
 * as a "recorded fact", not a live/active-override view — see its own
 * docblock). That's documented, intentional behavior to preserve, not
 * duplication to eliminate, so it stays separate. Only the part that's
 * truly identical either way — mapping already-resolved values onto
 * PaycheckInput's fields — is shared here.
 */
import type {
  PaycheckInput,
  DeductionLine,
  TaxBracketInput,
  ContributionAccountInput,
} from "@/lib/calculators/types";
import type { BonusTerms } from "./salary";
import { toNumber } from "./transforms";
import { requireLimit } from "./settings";

export interface JobForPaycheckInput {
  payPeriod: PaycheckInput["payPeriod"];
  payWeek: PaycheckInput["payWeek"];
  anchorPayDate: string | Date | null;
  startDate: string | Date;
  include401kInBonus: boolean;
  bonusMonth: number | null;
  bonusDayOfMonth: number | null;
}

export interface ResolvedPaycheckInputs {
  salary: number;
  bonusTerms: BonusTerms;
  /** This year's pinned actual bonus, if any — null means "use the formula." */
  bonusOverride: number | null;
  contributionAccounts: ContributionAccountInput[];
  deductions: DeductionLine[];
  taxBrackets: TaxBracketInput;
  limitsMap: Map<string, number>;
  limitsRecord: Record<string, number>;
  asOfDate: Date;
}

/**
 * Maps already-resolved job/salary/contribution/deduction values onto a
 * PaycheckInput. `bonusMultiplier` treats a genuinely unset (null) value as
 * 1× (not 0×) — see calculatePaycheck's `(input.bonusMultiplier ?? 1)` and
 * computeBonusGross's identical distinction between "0 = no bonus this
 * cycle" and "null = unset".
 */
export function buildPaycheckInputForJob(
  job: JobForPaycheckInput,
  resolved: ResolvedPaycheckInputs,
): PaycheckInput {
  return {
    annualSalary: resolved.salary,
    payPeriod: job.payPeriod,
    payWeek: job.payWeek,
    anchorPayDate: new Date(job.anchorPayDate ?? job.startDate),
    supplementalTaxRate: requireLimit(
      resolved.limitsMap,
      "supplemental_tax_rate",
    ),
    contributionAccounts: resolved.contributionAccounts,
    deductions: resolved.deductions,
    taxBrackets: resolved.taxBrackets,
    limits: resolved.limitsRecord,
    ytdGrossEarnings: 0,
    bonusPercent: toNumber(resolved.bonusTerms.bonusPercent),
    bonusMultiplier:
      resolved.bonusTerms.bonusMultiplier === null
        ? 1
        : toNumber(resolved.bonusTerms.bonusMultiplier),
    bonusOverride: resolved.bonusOverride,
    monthsInBonusYear: resolved.bonusTerms.monthsInBonusYear ?? 12,
    includeContribInBonus: job.include401kInBonus,
    bonusMonth: job.bonusMonth,
    bonusDayOfMonth: job.bonusDayOfMonth,
    asOfDate: resolved.asOfDate,
  };
}
