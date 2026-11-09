import type { calculateContributions } from "@/lib/pure/contributions/contribution-totals";
import type {
  AccountViewMetrics,
  ViewAwareTotals,
} from "@/lib/pure/contributions/view-metrics";
import type { ViewMode } from "@/lib/pure/contributions/view-mode";

export type AccountTypeSnapshot = {
  accountType: string; // display label (e.g. '401k', 'ESPP', 'Long Term Brokerage')
  categoryKey: string; // base config key for color lookup (e.g. 'brokerage' for all brokerage sub-types, 'espp' for ESPP)
  parentCategory: string; // 'Retirement' or 'Portfolio' — from DB parentCategory column
  limit: number;
  /** HSA coverage behind the limit (family if any of the rows has it);
   *  null for other types or when not set. */
  hsaCoverageType: string | null;
  /** How much the configured contributions are over the IRS limit (the
   *  figures above already show the capped amounts). */
  overBy: number;
  /** What to fix on this type's contributions (capMessage), if anything. */
  capMessages: string[];
  employeeContrib: number;
  employerMatch: number;
  /** The full match at the plan's cap — employerMatch when nothing is left
   *  on the table (FOO step 2). */
  employerMatchAvailable: number;
  totalContrib: number; // employee + employer (toward limit where applicable)
  views: Record<ViewMode, AccountViewMetrics>;
  ytdDataStale: boolean; // true when YTD actual < expected — performance data may be behind
  /** The percent-of-pay election (whole number, e.g. 15); null for fixed-amount contributions. */
  currentPctOfSalary: number | null;
  /** The percent of pay (whole number) that gets the full employer match;
   *  null when the match doesn't depend on the contribution rate. */
  fullMatchPctOfSalary: number | null;
  /** True pre-tax (Traditional) contributions only — hsa/afterTax are NOT
   *  folded in here; see afterTaxContrib/hsaContrib below. */
  tradContrib: number;
  taxFreeContrib: number; // Roth
  /** Taxable/brokerage contributions (taxTreatment: "after_tax"). */
  afterTaxContrib: number;
  /** HSA contributions (taxTreatment: "hsa"). Tracked separately from
   *  tradContrib since HSA isn't Traditional/pre-tax retirement money. */
  hsaContrib: number;
  /** Contributions not deducted from the paycheck (IRA, manually-funded brokerage/HSA), resolved
   *  like buildContribAccounts' isPayrollDeducted. Not tax treatment: a Roth 401k is post-tax
   *  but payroll-deducted, so it is not here. */
  nonPayrollContrib: number;
  /** The complement of nonPayrollContrib — deducted from the paycheck
   *  before net pay is computed, regardless of tax treatment. */
  payrollDeductedContrib: number;
  bonusContrib: number; // estimated 401k from bonus
  isJoint: boolean;
  hasDiscountBar: boolean; // config-driven: ESPP-style discount bar rendering
  employerMatchLabel: string; // config-driven: 'match' or 'disc.' etc.
  targetAnnual: number | null; // user's self-imposed annual target (null = no target)
  /** The tracked (Performance) accounts this row's contributions feed — joins it to live status. */
  performanceAccountIds: number[];
  allocationPriority: number; // overflow routing priority (lower = higher priority)
  priorYear?: {
    amount: number; // total designated for prior tax year across all contribs in this category
    limit: number; // prior year's IRS limit
    remaining: number; // room left in prior year
    contribs: { id: number; amount: number }[]; // per-contrib breakdown for inline editing
  };
};

/** Per-raw-contrib computed data — lets consumers (e.g. Paycheck page) use
 *  pre-computed values instead of re-deriving annual amounts, limits, and siblings. */
export type PerContributionData = {
  contribId: number;
  annualAmount: number;
  employerMatchAnnual: number;
  limit: number; // resolved IRS limit (with coverage variant + catchup)
  siblingAnnualTotal: number; // sum of annual amounts for other contribs in same limit group
  limitGroup: string | null;
  /** Actual YTD contributions from performance data (null if no performance account linked). */
  ytdActual: { contributions: number; employerMatch: number } | null;
  priorYear?: {
    amount: number; // designated for prior tax year
    limit: number; // prior year's IRS limit
    remaining: number; // room left in prior year
  };
};

export type PersonSnapshot = {
  person: { id: number; name: string };
  salary: number;
  /** Total compensation (always includes bonus) — used for savings rate denominator. */
  totalCompensation: number;
  bonusGross: number;
  periodsPerYear: number;
  periodsElapsedYtd: number;
  accountTypes: AccountTypeSnapshot[];
  perContribData: PerContributionData[];
  totals: {
    views: Record<ViewMode, ViewAwareTotals>;
    /** Actual YTD retirement contributions from performance data. */
    ytdActualRetirement: number;
    /** Actual YTD portfolio contributions from performance data. */
    ytdActualPortfolio: number;
    /** Actual YTD retirement employer match from performance data. */
    ytdActualRetirementMatch: number;
    /** Actual YTD portfolio employer match from performance data. */
    ytdActualPortfolioMatch: number;
  };
  result: ReturnType<typeof calculateContributions> | null;
};
