/**
 * A complete Salary Profile entry for a job — what the app stores (every
 * field set; salaryEntrySchema validates writes). Defaults: no pay, no
 * bonus, biweekly, MFJ, no extra-paycheck routing.
 */
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";

export function salaryEntry(overrides: Partial<SalaryEntry> = {}): SalaryEntry {
  return {
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
    ...overrides,
  };
}
