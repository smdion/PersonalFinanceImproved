/** App-level enum values for `text` columns (RULES.md principle 9: validation is app-level).
 *  Each const array → a Zod enum in enum-values.schema.ts → tRPC validators. Values only, so
 *  client components can import this without bundling Zod. */

import { BUDGET_API_SERVICE_VALUES } from "./budget-apps";

// ── Pay Period ──

export const PAY_PERIOD_VALUES = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
] as const;
export type PayPeriod = (typeof PAY_PERIOD_VALUES)[number];

// ── Salary divisor ──

/** What a job's salary is divided by for each check (a Salary Profile entry's `salaryDivisor`):
 *  the pay schedule's usual periods (26 biweekly: a 27-payday year pays an extra check), or
 *  the year's own paydays (27 in a 27-payday year: the year's pay stays the salary). */
export const SALARY_DIVISOR_VALUES = ["pay_periods", "paydays"] as const;
export type SalaryDivisor = (typeof SALARY_DIVISOR_VALUES)[number];
/** A Salary Profile entry with no `salaryDivisor` reads this. */
export const DEFAULT_SALARY_DIVISOR: SalaryDivisor = "pay_periods";

// ── Investment transaction kind (SimpleFIN ingest) ──
// Only `contribution` and `withdrawal` move money into or out of an account;
// everything else happens inside it (see simplefin-transaction-rules).

export const INVESTMENT_TRANSACTION_KIND_VALUES = [
  "contribution", // money in from outside (payroll, bank deposit, IRA conversion in)
  "withdrawal", // money out (distribution, conversion out, HSA medical spending)
  "dividend", // income paid by a holding (stays in the account)
  "interest", // money-market / cash interest (stays in the account)
  "fee", // account or fund fee taken from the balance
  "trade", // buy or sell of a holding (value moves between holdings)
  "sweep", // cash moved between the settlement/core fund and cash
  "gain_loss", // realized gain/loss bookkeeping row (no money moves)
  "transfer", // between the household's own accounts (IRA conversion, rollover) — not money added or taken out
  "other", // unrecognised — shown for review, never dropped
] as const;
export type InvestmentTransactionKind =
  (typeof INVESTMENT_TRANSACTION_KIND_VALUES)[number];
/** Kinds that are income in the year they're paid (taxable in a taxable
 *  account): dividends incl. capital-gain distributions, and interest. */
export const INVESTMENT_INCOME_KINDS: ReadonlySet<InvestmentTransactionKind> =
  new Set(["dividend", "interest"]);

// ── Security kind (holdings) ──

export const SECURITY_KIND_VALUES = [
  "etf",
  "mutual_fund",
  "plan_fund", // workplace-plan fund with no public ticker (collective trust etc.)
  "stock",
  "money_market",
  "cash",
  "other",
] as const;
export type SecurityKind = (typeof SECURITY_KIND_VALUES)[number];
/** Kinds worth the same at every close (a stable $1 price): never a market move. */
export const CASH_LIKE_SECURITY_KINDS: ReadonlySet<SecurityKind> = new Set([
  "money_market",
  "cash",
]);

// ── Fund facts (SEC filings / user) ──

export const SECURITY_FACT_SOURCE_VALUES = [
  "sec_nport", // composition from the fund's latest N-PORT portfolio report
  "sec_ncsr", // expense ratio from its latest shareholder report (N-CSR)
  "sec_nmfp", // money market fund: all cash, per its N-MFP report (money market funds don't file N-PORT)
  "user", // entered or confirmed by the household
] as const;
export type SecurityFactSource = (typeof SECURITY_FACT_SOURCE_VALUES)[number];

/**
 * Whose SEC filings supply a fund's facts: its own, a registered stand-in,
 * or none (the household said no stand-in fits — don't suggest again).
 */
export const FACTS_BASIS_VALUES = ["exact", "standin", "none"] as const;
export type FactsBasis = (typeof FACTS_BASIS_VALUES)[number];

/**
 * Composition buckets a fund's holdings are summed into. Fixed set; each
 * counts toward at most one asset class (asset_class_buckets), and a class
 * can take several.
 */
export const COMPOSITION_BUCKET_VALUES = [
  "us_equity",
  "intl_equity",
  "us_bond",
  "intl_bond",
  "tips",
  "cash",
  "other",
] as const;
export type CompositionBucket = (typeof COMPOSITION_BUCKET_VALUES)[number];
/** The stock buckets — what "stock share" means wherever a mix is compared
 *  with a stock/bond split (e.g. Vanguard's target-date glide path). */
const STOCK_COMPOSITION_BUCKETS: ReadonlySet<CompositionBucket> = new Set([
  "us_equity",
  "intl_equity",
]);
export function isStockBucket(bucket: CompositionBucket): boolean {
  return STOCK_COMPOSITION_BUCKETS.has(bucket);
}
/** The categories shown as their own rows in mix-vs-target ("other" is a note). */
export const MAJOR_COMPOSITION_BUCKETS: readonly CompositionBucket[] =
  COMPOSITION_BUCKET_VALUES.filter((b) => b !== "other");

// ── Holding observation source ──

export const HOLDING_SOURCE_VALUES = ["simplefin"] as const;
export type HoldingSource = (typeof HOLDING_SOURCE_VALUES)[number];

// ── Holding period basis ──

/** Where a dated holding period came from. Observed periods (daily
 *  SimpleFIN holdings) aren't stored — they're derived on read. */
export const HOLDING_PERIOD_BASIS_VALUES = ["user", "inferred"] as const;
export type HoldingPeriodBasis = (typeof HOLDING_PERIOD_BASIS_VALUES)[number];

// ── Pay Week ──

export const PAY_WEEK_VALUES = ["even", "odd", "na"] as const;
export type PayWeek = (typeof PAY_WEEK_VALUES)[number];

// ── Tax Treatment ──

export const TAX_TREATMENT_VALUES = [
  "pre_tax",
  "tax_free",
  "after_tax",
  "hsa",
] as const;
export type TaxTreatment = (typeof TAX_TREATMENT_VALUES)[number];

// ── Match Tax Treatment ──

export const MATCH_TAX_TREATMENT_VALUES = ["pre_tax", "tax_free"] as const;
export type MatchTaxTreatment = (typeof MATCH_TAX_TREATMENT_VALUES)[number];

// ── Contribution Method ──

export const CONTRIBUTION_METHOD_VALUES = [
  "percent_of_salary",
  "fixed_per_period",
  "fixed_monthly",
  "fixed_annual",
] as const;
export type ContributionMethod = (typeof CONTRIBUTION_METHOD_VALUES)[number];

// ── Employer Match Type ──

export const EMPLOYER_MATCH_TYPE_VALUES = [
  "none",
  "percent_of_contribution",
  "dollar_match",
  "fixed_annual",
] as const;
export type EmployerMatchType = (typeof EMPLOYER_MATCH_TYPE_VALUES)[number];

// ── HSA Coverage Type ──

export const HSA_COVERAGE_TYPE_VALUES = ["self_only", "family"] as const;
export type HsaCoverageType = (typeof HSA_COVERAGE_TYPE_VALUES)[number];
/** The coverage type whose limit is the family variant (IRS Pub 969). */
export const HSA_FAMILY_COVERAGE: HsaCoverageType = "family";

// ── Account Ownership ──

export const ACCOUNT_OWNERSHIP_VALUES = ["individual", "joint"] as const;
export type AccountOwnership = (typeof ACCOUNT_OWNERSHIP_VALUES)[number];

// ── Bonus Destination ──

/** Where a job's bonus goes: into the budget, or extra spending outside it
 *  (Living Costs shows its take-home as its own bar). Absent = budget. */
export const BONUS_DESTINATION_VALUES = ["budget", "spending"] as const;
export type BonusDestination = (typeof BONUS_DESTINATION_VALUES)[number];
/** A Salary Profile entry with no `bonusDestination` sends it here. */
export const DEFAULT_BONUS_DESTINATION: BonusDestination = "budget";

// ── API Sync Direction ──

export const API_SYNC_DIRECTION_VALUES = ["pull", "push", "both"] as const;
export type ApiSyncDirection = (typeof API_SYNC_DIRECTION_VALUES)[number];

// ── Portfolio Tax Type ──

// ── Retirement Behavior ──

export const RETIREMENT_BEHAVIOR_VALUES = [
  "stops_at_owner_retirement",
  "stops_when_last_retires",
  "continues_after_retirement",
] as const;
export type RetirementBehavior = (typeof RETIREMENT_BEHAVIOR_VALUES)[number];

// ── Contribution Scaling ──

export const CONTRIBUTION_SCALING_VALUES = [
  "scales_with_salary",
  "fixed_amount",
] as const;
export type ContributionScaling = (typeof CONTRIBUTION_SCALING_VALUES)[number];

// ── Savings Goal Target Mode ──

export const TARGET_MODE_VALUES = ["fixed", "ongoing", "bucket"] as const;
export type TargetMode = (typeof TARGET_MODE_VALUES)[number];

// ── Portfolio Tax Type ──

export const PORTFOLIO_TAX_TYPE_VALUES = [
  "preTax",
  "taxFree",
  "hsa",
  "afterTax",
] as const;
export type PortfolioTaxType = (typeof PORTFOLIO_TAX_TYPE_VALUES)[number];

// ── Utility Kind ──

export const UTILITY_KIND_VALUES = ["gas", "water", "electric"] as const;
export type UtilityKind = (typeof UTILITY_KIND_VALUES)[number];

// ── Utility Usage Unit ──

export const UTILITY_UNIT_VALUES = ["ccf", "gallon", "kWh"] as const;
export type UtilityUnit = (typeof UTILITY_UNIT_VALUES)[number];
/** The unit each kind is usually billed in — the add form's starting choice. */
export const UTILITY_USUAL_UNIT: Record<UtilityKind, UtilityUnit> = {
  gas: "ccf",
  water: "gallon",
  electric: "kWh",
};

/** Who wrote a utility reading's cost: typed in, the one-time spreadsheet
 *  import, or the budget service the cost feed pulled it from. */
export const UTILITY_SOURCE_VALUES = [
  "import",
  "manual",
  ...BUDGET_API_SERVICE_VALUES,
] as const;
export type UtilitySource = (typeof UTILITY_SOURCE_VALUES)[number];

/** A community tax-data update's state (`tax_data_updates.status`). */
export const TAX_DATA_UPDATE_STATUS_VALUES = [
  "pending", // fetched and verified, waiting for an admin
  "applied",
  "dismissed",
] as const;
export type TaxDataUpdateStatus =
  (typeof TAX_DATA_UPDATE_STATUS_VALUES)[number];

/** What a suggested stand-in fund's own SEC filings say (securities.standinPreview). Shares are fractions (0–1). */
export type StandInPreview = {
  /** Share of the stand-in's holdings its filings classify; null if no holdings filing. */
  coverage: number | null;
  mix: Record<CompositionBucket, number> | null;
  /** Cheapest share class's expense ratio (a retail fee, not the plan's). */
  expenseRatio: number | null;
  /** Period the holdings are as of. */
  asOf: string | null;
  checkedAt: string;
  /** Filings the figures came from — unchanged ones aren't downloaded again. */
  nportAccession?: string | null;
  ncsrAccession?: string | null;
  /** Why the last check failed (the figures above are from the one before). */
  error?: string | null;
};

/** How a Roth IRA contribution gets there (a Contribution Profile choice; absent = direct):
 *  directly, or backdoor: a non-deductible traditional IRA contribution converted to the
 *  Roth (works at any income). */
export const ROTH_IRA_ROUTE_VALUES = ["direct", "backdoor"] as const;
export type RothIraRoute = (typeof ROTH_IRA_ROUTE_VALUES)[number];

// ── Debts (labels and the high-interest line per kind: lib/config/debts.ts) ──

export const DEBT_KIND_VALUES = [
  "student_loan",
  "auto_loan",
  "credit_card",
  "personal_loan",
  "medical",
  "other",
] as const;
export type DebtKind = (typeof DEBT_KIND_VALUES)[number];

/** A view's dollars: as projected, or today's ("real"). */
export const DOLLAR_BASIS_VALUES = ["nominal", "real"] as const;
export type DollarBasis = (typeof DOLLAR_BASIS_VALUES)[number];
