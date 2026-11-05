import type { AccountCategory } from "@/lib/config/account-types";
import type { ContributionMethod } from "@/lib/config/enum-values";

/**
 * Per-account contribution spec derived from paycheck/contributions DB data.
 * The engine uses these to project contributions per-account for years 1+,
 * respecting each account's contribution method and IRS limits.
 */
export type ContributionSpec = {
  /** Waterfall category this account maps to. */
  category: AccountCategory;
  /** Human-readable account name (e.g. "401k", "ESPP", "HSA"). */
  name: string;
  /** How contributions are defined. */
  method: ContributionMethod;
  /** A fraction of pay for percent_of_salary (0.16 = 16%), else dollars. */
  value: number;
  /** Fraction of total compensation this spec's job represents (0–1).
   *  For percent_of_salary: engine computes `projectedSalary × salaryFraction × value`
   *  so that multi-job households don't inflate per-account contributions.
   *  Defaults to 1.0 for single-job households. */
  salaryFraction: number;
  /** percent_of_salary: the pay this spec applies to as a share of its
   *  person's total pay (below 1 when the bonus check doesn't take
   *  this contribution — fromBonus). The engine re-derives salaryFraction from it each year
   *  when it tracks salary per person. Absent = 1. */
  personPayShare?: number;
  /** Periods per year (for fixed_per_period). Ignored for other methods. */
  periodsPerYear?: number;
  /** Current-year annual contribution (computed from value + salary/periods). */
  baseAnnual: number;
  /** Tax treatment of employee contributions. */
  taxTreatment: "pre_tax" | "tax_free" | "after_tax" | "hsa";
  /** Person who owns this contribution (for per-person salary tracking). */
  personId?: number | null;
  /** Owner name for matching to individual accounts. */
  ownerName?: string;
  /** Matched individual account display name (data-driven from DB). */
  accountName?: string;
  /** User's self-imposed annual contribution target (null = no cap). */
  targetAnnual?: number | null;
  /** Overflow allocation priority (lower = higher priority, 0 = default). */
  allocationPriority?: number;
  /** Parent category from contribution account config (e.g. "Retirement", "Portfolio"). */
  parentCategory?: string;
  /** Account ownership type (from contribution_accounts). */
  ownership?: "individual" | "joint";
  /** Post-retirement contribution behavior (from performance_accounts). */
  retirementBehavior?:
    | "stops_at_owner_retirement"
    | "stops_when_last_retires"
    | "continues_after_retirement";
  /** How this contribution scales during accumulation (from performance_accounts). */
  contributionScaling?: "scales_with_salary" | "fixed_amount";
  /** HSA coverage type (sizes the HSA limit); null/absent = none given. */
  hsaCoverageType?: string | null;
  /** Set only when the row is over its IRS limit: its configured yearly
   *  money (`baseAnnual` is the capped amount). Year 0 then counts what it
   *  has already put in at the configured rate (late-year rule). */
  configuredAnnual?: number;
  /** This row's share of its category's base-year employer money — the
   *  year's employer money held against the IRS limit is this share of the
   *  money the engine credits (yearEmployerMatch). Absent = 0. */
  employerShare?: number;
  /** False for flat employer money (a set yearly amount), which keeps coming
   *  while contributions are paused. Absent = it depends on contributing. */
  matchNeedsContribution?: boolean;
};

/** A mid-projection contribution profile switch entry.
 *  Contains the contribution structure to swap in at the target year.
 *  Salary overrides from profiles are handled separately via perPersonSalaryOverrides. */
export type ProfileSwitch = {
  year: number;
  contributionSpecs: ContributionSpec[];
  employerMatchRateByCategory: Record<AccountCategory, number>;
  /** Base-year contributions per category. Used for year-0 real-contrib path
   *  and brokerage intentional-contribution detection in all years. */
  baseYearContributions: Record<AccountCategory, number>;
  baseYearEmployerMatch: Record<AccountCategory, number>;
  employerMatchByParentCat?: Map<AccountCategory, Map<string, number>>;
  /** Contribution rate ceiling derived from this profile's total contributions / compensation. */
  contributionRate: number;
  /** This profile's base-year amounts and match over retirement money only
   *  — what Simple tax mode swaps in (simple-tax-mode.ts). Set by the
   *  payload; switches built elsewhere never reach Simple. */
  retirementOnly?: RetirementContribSlice;
};

/** A contribution profile's base-year amounts and match over retirement
 *  money only (built from paycheck data next to the all-accounts ones). */
export type RetirementContribSlice = {
  baseYearContributions: Record<AccountCategory, number>;
  baseYearEmployerMatch: Record<AccountCategory, number>;
  employerMatchRateByCategory: Record<AccountCategory, number>;
};
