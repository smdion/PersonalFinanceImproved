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

// ── Pay Period ──

export const PAY_PERIOD_VALUES = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
] as const;
export type PayPeriod = (typeof PAY_PERIOD_VALUES)[number];
export const payPeriodSchema = z.enum(PAY_PERIOD_VALUES);

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

// ── Portfolio Tax Type ──

export const PORTFOLIO_TAX_TYPE_VALUES = [
  "preTax",
  "taxFree",
  "hsa",
  "afterTax",
] as const;
export type PortfolioTaxType = (typeof PORTFOLIO_TAX_TYPE_VALUES)[number];
export const portfolioTaxTypeSchema = z.enum(PORTFOLIO_TAX_TYPE_VALUES);
