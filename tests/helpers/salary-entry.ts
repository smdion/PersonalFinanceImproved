/**
 * A complete Salary Profile entry for a job — what the app stores (every
 * field set; salaryEntrySchema validates writes). Defaults: no pay, no
 * bonus, biweekly, MFJ, no extra-paycheck routing.
 */
import type { SalaryProfileEntry } from "@/server/helpers/salary";

export function salaryEntry(
  overrides: Partial<SalaryProfileEntry> = {},
): SalaryProfileEntry {
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
