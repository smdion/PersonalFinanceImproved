import type { AccountCategory } from "@/lib/config/account-types";

/** A contribution profile's base-year amounts and match over retirement
 *  money only (built from paycheck data next to the all-accounts ones). */
export type RetirementContributionSlice = {
  baseYearContributions: Record<AccountCategory, number>;
  baseYearEmployerMatch: Record<AccountCategory, number>;
  employerMatchRateByCategory: Record<AccountCategory, number>;
};
