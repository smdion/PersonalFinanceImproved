/**
 * App-level enum value definitions and Zod validators.
 *
 * These replace the former pgEnum declarations in the schema. All constrained-value
 * columns are now `text` in the database, validated here at the app layer via Zod.
 * This follows RULES.md principle 9: "Account type validation is app-level, not DB-level."
 *
 * Pattern: const array → derived Zod enum → exported for use in tRPC input validators.
 */

import { z } from "zod";

// ── Decimal string (shared across routers and JSONB active-field schemas) ──

/** Validates a string represents a valid decimal number. */
export const zDecimal = z
  .string()
  .refine((v) => !isNaN(Number(v)) && v.trim() !== "", {
    message: "Must be a valid number",
  });

// ── Pay Period ──

export const PAY_PERIOD_VALUES = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
] as const;
export type PayPeriod = (typeof PAY_PERIOD_VALUES)[number];
export const payPeriodSchema = z.enum(PAY_PERIOD_VALUES);

// ── Investment transaction kind (SimpleFIN ingest) ──
// What a brokerage/401k/HSA transaction row means for performance math.
// Only `contribution` and `withdrawal` move money into or out of an
// account; everything else happens inside it (see simplefin-transaction-rules).

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
export const investmentTransactionKindSchema = z.enum(
  INVESTMENT_TRANSACTION_KIND_VALUES,
);

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
export const securityKindSchema = z.enum(SECURITY_KIND_VALUES);

// ── Fund facts (SEC filings / user) ──

export const SECURITY_FACT_SOURCE_VALUES = [
  "sec_nport", // composition from the fund's latest N-PORT portfolio report
  "sec_ncsr", // expense ratio from its latest shareholder report (N-CSR)
  "sec_nmfp", // money market fund: all cash, per its N-MFP report (money market funds don't file N-PORT)
  "user", // entered or confirmed by the household
] as const;
export type SecurityFactSource = (typeof SECURITY_FACT_SOURCE_VALUES)[number];
export const securityFactSourceSchema = z.enum(SECURITY_FACT_SOURCE_VALUES);

/**
 * Whose SEC filings supply a fund's facts: its own, a registered stand-in,
 * or none (the household said no stand-in fits — don't suggest again).
 */
export const FACTS_BASIS_VALUES = ["exact", "standin", "none"] as const;
export type FactsBasis = (typeof FACTS_BASIS_VALUES)[number];
export const factsBasisSchema = z.enum(FACTS_BASIS_VALUES);

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
export const compositionBucketSchema = z.enum(COMPOSITION_BUCKET_VALUES);
/** The categories shown as their own rows in mix-vs-target ("other" is a note). */
export const MAJOR_COMPOSITION_BUCKETS: readonly CompositionBucket[] =
  COMPOSITION_BUCKET_VALUES.filter((b) => b !== "other");

// ── Holding observation source ──

export const HOLDING_SOURCE_VALUES = ["simplefin", "manual"] as const;
export type HoldingSource = (typeof HOLDING_SOURCE_VALUES)[number];
export const holdingSourceSchema = z.enum(HOLDING_SOURCE_VALUES);

// ── Pay Week ──

export const PAY_WEEK_VALUES = ["even", "odd", "na"] as const;
export type PayWeek = (typeof PAY_WEEK_VALUES)[number];
export const payWeekSchema = z.enum(PAY_WEEK_VALUES);

// ── Tax Treatment ──

export const TAX_TREATMENT_VALUES = [
  "pre_tax",
  "tax_free",
  "after_tax",
  "hsa",
] as const;
export type TaxTreatment = (typeof TAX_TREATMENT_VALUES)[number];
export const taxTreatmentSchema = z.enum(TAX_TREATMENT_VALUES);

// ── Match Tax Treatment ──

export const MATCH_TAX_TREATMENT_VALUES = ["pre_tax", "tax_free"] as const;
export type MatchTaxTreatment = (typeof MATCH_TAX_TREATMENT_VALUES)[number];
export const matchTaxTreatmentSchema = z.enum(MATCH_TAX_TREATMENT_VALUES);

// ── Contribution Method ──

export const CONTRIBUTION_METHOD_VALUES = [
  "percent_of_salary",
  "fixed_per_period",
  "fixed_monthly",
  "fixed_annual",
] as const;
export type ContributionMethod = (typeof CONTRIBUTION_METHOD_VALUES)[number];
export const contributionMethodSchema = z.enum(CONTRIBUTION_METHOD_VALUES);

// ── Employer Match Type ──

export const EMPLOYER_MATCH_TYPE_VALUES = [
  "none",
  "percent_of_contribution",
  "dollar_match",
  "fixed_annual",
] as const;
export type EmployerMatchType = (typeof EMPLOYER_MATCH_TYPE_VALUES)[number];
export const employerMatchTypeSchema = z.enum(EMPLOYER_MATCH_TYPE_VALUES);

// ── HSA Coverage Type ──

export const HSA_COVERAGE_TYPE_VALUES = ["self_only", "family"] as const;
export type HsaCoverageType = (typeof HSA_COVERAGE_TYPE_VALUES)[number];
export const hsaCoverageTypeSchema = z.enum(HSA_COVERAGE_TYPE_VALUES);

// ── Account Ownership ──

export const ACCOUNT_OWNERSHIP_VALUES = ["individual", "joint"] as const;
export type AccountOwnership = (typeof ACCOUNT_OWNERSHIP_VALUES)[number];
export const accountOwnershipSchema = z.enum(ACCOUNT_OWNERSHIP_VALUES);

// ── W-4 Filing Status ──

export const W4_FILING_STATUS_VALUES = ["MFJ", "Single", "HOH"] as const;
export type W4FilingStatus = (typeof W4_FILING_STATUS_VALUES)[number];
export const w4FilingStatusSchema = z.enum(W4_FILING_STATUS_VALUES);

// ── Budget API Service ──

export const BUDGET_API_SERVICE_VALUES = ["ynab", "actual"] as const;
export type BudgetApiService = (typeof BUDGET_API_SERVICE_VALUES)[number];
export const budgetApiServiceSchema = z.enum(BUDGET_API_SERVICE_VALUES);

// ── API Sync Direction ──

export const API_SYNC_DIRECTION_VALUES = ["pull", "push", "both"] as const;
export type ApiSyncDirection = (typeof API_SYNC_DIRECTION_VALUES)[number];
export const apiSyncDirectionSchema = z.enum(API_SYNC_DIRECTION_VALUES);

// ── Portfolio Tax Type ──

// ── Retirement Behavior ──

export const RETIREMENT_BEHAVIOR_VALUES = [
  "stops_at_owner_retirement",
  "stops_when_last_retires",
  "continues_after_retirement",
] as const;
export type RetirementBehavior = (typeof RETIREMENT_BEHAVIOR_VALUES)[number];
export const retirementBehaviorSchema = z.enum(RETIREMENT_BEHAVIOR_VALUES);

// ── Contribution Scaling ──

export const CONTRIBUTION_SCALING_VALUES = [
  "scales_with_salary",
  "fixed_amount",
] as const;
export type ContributionScaling = (typeof CONTRIBUTION_SCALING_VALUES)[number];
export const contributionScalingSchema = z.enum(CONTRIBUTION_SCALING_VALUES);

// ── Savings Goal Target Mode ──

export const TARGET_MODE_VALUES = ["fixed", "ongoing", "bucket"] as const;
export type TargetMode = (typeof TARGET_MODE_VALUES)[number];
export const targetModeSchema = z.enum(TARGET_MODE_VALUES);

// ── Portfolio Tax Type ──

export const PORTFOLIO_TAX_TYPE_VALUES = [
  "preTax",
  "taxFree",
  "hsa",
  "afterTax",
] as const;
export type PortfolioTaxType = (typeof PORTFOLIO_TAX_TYPE_VALUES)[number];
export const portfolioTaxTypeSchema = z.enum(PORTFOLIO_TAX_TYPE_VALUES);

// ── Utility Kind ──

export const UTILITY_KIND_VALUES = ["gas", "water", "electric"] as const;
export type UtilityKind = (typeof UTILITY_KIND_VALUES)[number];
export const utilityKindSchema = z.enum(UTILITY_KIND_VALUES);

// ── Utility Usage Unit ──

export const UTILITY_UNIT_VALUES = ["ccf", "gallon", "kWh"] as const;
export type UtilityUnit = (typeof UTILITY_UNIT_VALUES)[number];
export const utilityUnitSchema = z.enum(UTILITY_UNIT_VALUES);

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
