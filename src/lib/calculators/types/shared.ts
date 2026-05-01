// Shared types used across multiple calculator domains.
// These are the building blocks that other domain files depend on.

import type {
  AccountCategory,
  AccountBalance,
} from "@/lib/config/account-types";

export type ViewMode = "projected" | "blended" | "ytd";

export type PayPeriodType = "weekly" | "biweekly" | "semimonthly" | "monthly";
export type TaxTreatmentType = "pre_tax" | "tax_free" | "after_tax" | "hsa";
export type FilingStatusType = "MFJ" | "Single" | "HOH";

export type DeductionLine = {
  name: string;
  amount: number;
  taxTreatment: TaxTreatmentType;
  ficaExempt: boolean;
};

export type TaxBracketInput = {
  filingStatus: FilingStatusType;
  w4Checkbox: boolean; // whether this bracket set is the 2(c) checked version
  brackets: { min: number; max: number | null; rate: number }[];
  standardDeduction: number;
  socialSecurityWageBase: number;
  socialSecurityRate: number;
  medicareRate: number;
  medicareAdditionalRate: number;
  medicareAdditionalThreshold: number;
};

export type ContributionAccountInput = {
  name: string;
  annualContribution: number;
  perPeriodContribution: number;
  /** Fractional rate of gross pay (e.g. 0.14 for 14%). Non-null only for
   *  percent_of_salary accounts — used to scale contributions against bonus
   *  gross rather than reusing the regular per-period dollar amount. */
  rateOfGross: number | null;
  taxTreatment: TaxTreatmentType;
  isPayrollDeducted: boolean;
  group: string; // e.g. 'retirement', 'portfolio' — driven by account data, not hardcoded
  employerMatch: number;
  employerMatchTaxTreatment: TaxTreatmentType;
};

/**
 * A one-time dollar-amount injection or withdrawal in a specific year.
 * NOT sticky-forward — only applied in the exact override year.
 * Bypasses IRS contribution limits (models rollovers, inheritances, etc.).
 */
export type LumpSum = {
  amount: number;
  targetAccount: AccountCategory;
  taxType?: "traditional" | "roth";
  /** Specific individual account name (e.g., "Long Term Brokerage (Vanguard)").
   *  When set, the engine adds the lump sum to this exact account in indBal. */
  targetAccountName?: string;
  label?: string;
};

/** Override salary or budget at a specific calendar year in the projection. */
export type RetirementYearOverride = {
  year: number;
  value: number;
  notes?: string;
};

/** Per-tax-bucket breakdown used throughout retirement projection */
export type TaxBuckets = {
  preTax: number;
  taxFree: number;
  hsa: number;
  afterTax: number;
  /** Cost basis of after-tax (brokerage) holdings. Only gains (afterTax - afterTaxBasis) are taxable on withdrawal. */
  afterTaxBasis: number;
};

/**
 * Per-account balance breakdown by waterfall category and tax treatment.
 * More granular than TaxBuckets — tracks 401k vs IRA separately so
 * decumulation routing uses real balances instead of heuristic splits.
 *
 * Each entry is a discriminated union (AccountBalance) whose shape is
 * determined by the account type's `balanceStructure` config property.
 */
export type AccountBalances = Record<AccountCategory, AccountBalance>;

/** Individual account input for per-account engine tracking. */
export type IndividualAccountInput = {
  /** Display name (e.g. "Alice HSA", "Bob Roth IRA"). */
  name: string;
  /** Waterfall category this account belongs to. */
  category: AccountCategory;
  /** Tax type: 'taxFree' for Roth, 'preTax'/'hsa'/'afterTax' for others. */
  taxType: string;
  /** Raw account type from DB (e.g. "401k", "IRA Traditional", "ESPP"). */
  accountType?: string;
  /** Starting balance from portfolio snapshot. */
  startingBalance: number;
  /** Owner person name (from DB lookup). */
  ownerName?: string;
  /** Owner person ID (from DB). Used for ID-based matching to contribution specs. */
  ownerPersonId?: number;
  /** Parent category from contribution account config (e.g. "Retirement", "Portfolio"). */
  parentCategory?: string;
};

/** Per-account balance tracked through the engine projection. */
export type IndividualAccountYearBalance = {
  name: string;
  category: AccountCategory;
  taxType: string;
  ownerName?: string;
  /** Owner person ID (from DB). Used for ID-based person filtering. */
  ownerPersonId?: number;
  /** Parent category from contribution account config (e.g. "Retirement", "Portfolio"). */
  parentCategory?: string;
  balance: number;
  contribution: number;
  employerMatch: number;
  growth: number;
  /** Per-account withdrawal amount (decumulation only). */
  withdrawal?: number;
  /** Breakdown of contribution sources (brokerage accounts only). */
  intentionalContribution?: number;
  overflowContribution?: number;
  rampContribution?: number;
};

/** Account category — auto-derived from ACCOUNT_TYPE_CONFIG keys. Re-exported for convenience. */
export type {
  AccountCategory,
  AccountBalance,
} from "@/lib/config/account-types";
