/**
 * A new Salary Profile entry: no pay or bonus, biweekly, MFJ, no extra withholding. Used by
 * "+ Add", onboarding and getById for a job the profile lacks; never a calculation fallback
 * (a job with no entry contributes $0).
 */
import type { z } from "zod/v4";
import type { salaryEntrySchema } from "@/lib/db/shapes/json-schemas";

export type SalaryEntry = z.infer<typeof salaryEntrySchema>;

export const BLANK_SALARY_ENTRY = {
  salary: 0,
  bonusPercent: 0,
  bonusMultiplier: 1,
  monthsInBonusYear: 12,
  bonusOverride: null,
  payPeriod: "biweekly",
  payWeek: "na",
  anchorPayDate: null,
  budgetPeriodsPerMonth: null,
  w4FilingStatus: "MFJ",
  w4Box2cChecked: false,
  additionalFedWithholding: 0,
  bonusMonth: null,
  bonusDayOfMonth: null,
  extraPaycheckRouting: null,
} as const satisfies SalaryEntry;
