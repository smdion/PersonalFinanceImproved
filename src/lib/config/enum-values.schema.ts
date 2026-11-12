// The Zod enums for enum-values.ts, apart from it: client components read
// its values, and Zod stays out of their bundle (as filing-status.schema.ts).
import { z } from "zod/v4";
import { BUDGET_API_SERVICE_VALUES } from "@/lib/config/budget-apps";
import {
  ACCOUNT_OWNERSHIP_VALUES,
  API_SYNC_DIRECTION_VALUES,
  BONUS_DESTINATION_VALUES,
  COMPOSITION_BUCKET_VALUES,
  CONTRIBUTION_METHOD_VALUES,
  CONTRIBUTION_SCALING_VALUES,
  DEBT_KIND_VALUES,
  EMPLOYER_MATCH_TYPE_VALUES,
  FACTS_BASIS_VALUES,
  HOLDING_PERIOD_BASIS_VALUES,
  HOLDING_SOURCE_VALUES,
  HSA_COVERAGE_TYPE_VALUES,
  INVESTMENT_TRANSACTION_KIND_VALUES,
  MATCH_TAX_TREATMENT_VALUES,
  PAY_PERIOD_VALUES,
  PAY_WEEK_VALUES,
  PORTFOLIO_TAX_TYPE_VALUES,
  RETIREMENT_BEHAVIOR_VALUES,
  SALARY_DIVISOR_VALUES,
  SECURITY_FACT_SOURCE_VALUES,
  SECURITY_KIND_VALUES,
  TARGET_MODE_VALUES,
  TAX_TREATMENT_VALUES,
  UTILITY_KIND_VALUES,
  UTILITY_SOURCE_VALUES,
  UTILITY_UNIT_VALUES,
} from "@/lib/config/enum-values";

export const payPeriodSchema = z.enum(PAY_PERIOD_VALUES);
export const investmentTransactionKindSchema = z.enum(
  INVESTMENT_TRANSACTION_KIND_VALUES,
);
export const securityKindSchema = z.enum(SECURITY_KIND_VALUES);
export const securityFactSourceSchema = z.enum(SECURITY_FACT_SOURCE_VALUES);
export const factsBasisSchema = z.enum(FACTS_BASIS_VALUES);
export const compositionBucketSchema = z.enum(COMPOSITION_BUCKET_VALUES);
export const holdingSourceSchema = z.enum(HOLDING_SOURCE_VALUES);
export const holdingPeriodBasisSchema = z.enum(HOLDING_PERIOD_BASIS_VALUES);
export const payWeekSchema = z.enum(PAY_WEEK_VALUES);
export const taxTreatmentSchema = z.enum(TAX_TREATMENT_VALUES);
export const matchTaxTreatmentSchema = z.enum(MATCH_TAX_TREATMENT_VALUES);
export const contributionMethodSchema = z.enum(CONTRIBUTION_METHOD_VALUES);
export const employerMatchTypeSchema = z.enum(EMPLOYER_MATCH_TYPE_VALUES);
export const hsaCoverageTypeSchema = z.enum(HSA_COVERAGE_TYPE_VALUES);
export const accountOwnershipSchema = z.enum(ACCOUNT_OWNERSHIP_VALUES);
export const bonusDestinationSchema = z.enum(BONUS_DESTINATION_VALUES);
export const salaryDivisorSchema = z.enum(SALARY_DIVISOR_VALUES);
export const budgetApiServiceSchema = z.enum(BUDGET_API_SERVICE_VALUES);
export const apiSyncDirectionSchema = z.enum(API_SYNC_DIRECTION_VALUES);
export const retirementBehaviorSchema = z.enum(RETIREMENT_BEHAVIOR_VALUES);
export const contributionScalingSchema = z.enum(CONTRIBUTION_SCALING_VALUES);
export const targetModeSchema = z.enum(TARGET_MODE_VALUES);
export const portfolioTaxTypeSchema = z.enum(PORTFOLIO_TAX_TYPE_VALUES);
export const utilityKindSchema = z.enum(UTILITY_KIND_VALUES);
export const utilityUnitSchema = z.enum(UTILITY_UNIT_VALUES);
export const utilitySourceSchema = z.enum(UTILITY_SOURCE_VALUES);
export const debtKindSchema = z.enum(DEBT_KIND_VALUES);
