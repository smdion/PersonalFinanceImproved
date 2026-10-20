/**
 * A brand-new Salary Profile entry: no pay or bonus yet, and the most common
 * setup for everything that can't be empty (biweekly, MFJ, no extra
 * withholding). The one definition — Profiles → Salary's "+ Add",
 * onboarding, and salaryProfile.getById's starting values for a job the
 * profile doesn't have yet. Never a fallback in a calculation: a job with no
 * entry contributes $0 everywhere.
 */
import type { z } from "zod/v4";
import type { salaryEntrySchema } from "@/lib/db/json-schemas";

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
