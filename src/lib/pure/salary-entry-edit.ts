/**
 * One field edit from a salary editor (Paycheck page, Profiles → Salary) →
 * the Salary Profile entry fields it sets. The one save path for both
 * editors: each sends the result to salaryProfile.patchEntry.
 *
 * Fields arrive as strings from the shared sections (BonusTerms,
 * TaxWithholdingSection, OtherPaySection, …).
 */
import {
  payPeriodSchema,
  payWeekSchema,
  w4FilingStatusSchema,
  type PayPeriod,
  type PayWeek,
  type W4FilingStatus,
} from "@/lib/config/enum-values";

/** Entry fields the parse can set (mirrors SalaryProfileEntry). */
export type SalaryEntryFields = {
  salary?: number;
  bonusPercent?: number;
  bonusMultiplier?: number;
  monthsInBonusYear?: number;
  bonusOverride?: number | null;
  payPeriod?: PayPeriod;
  payWeek?: PayWeek;
  anchorPayDate?: string | null;
  budgetPeriodsPerMonth?: number | null;
  w4FilingStatus?: W4FilingStatus;
  w4Box2cChecked?: boolean;
  additionalFedWithholding?: number;
  bonusMonth?: number | null;
  bonusDayOfMonth?: number | null;
  bonusDestination?: "budget" | "spending";
  otherEarnings?: Record<string, number>;
};

/** Entry fields that are one of a fixed set of values. */
const ENUM_FIELDS = {
  payPeriod: payPeriodSchema,
  payWeek: payWeekSchema,
  w4FilingStatus: w4FilingStatusSchema,
} as const;

const finite = (v: string) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

/**
 * - `undefined`: not a Salary Profile field (e.g. employer name — a job
 *   column, household setup).
 * - `null`: a Salary Profile field, but the value isn't valid — save nothing.
 * - otherwise the fields to patch.
 *
 * `otherEarnings` is the job's current other-pay amounts, so editing one
 * line keeps the rest.
 */
export function salaryEntryEdit(
  field: string,
  value: string,
  ctx: { otherEarnings: Record<string, number> } = { otherEarnings: {} },
): SalaryEntryFields | null | undefined {
  if (field.startsWith("otherEarnings:")) {
    const n = finite(value);
    if (n === null || n < 0) return null;
    return {
      otherEarnings: {
        ...ctx.otherEarnings,
        [field.slice("otherEarnings:".length)]: n,
      },
    };
  }
  switch (field) {
    case "annualSalary": {
      const n = finite(value);
      return n !== null && n > 0 ? { salary: n } : null;
    }
    case "bonusPercent":
    case "bonusMultiplier":
    case "monthsInBonusYear":
    case "additionalFedWithholding": {
      const n = finite(value);
      return n !== null && n >= 0 ? { [field]: n } : null;
    }
    case "bonusOverride": {
      if (value.trim() === "") return { bonusOverride: null };
      const n = finite(value);
      return n !== null && n >= 0 ? { bonusOverride: n } : null;
    }
    case "budgetPeriodsPerMonth": {
      if (value.trim() === "") return { budgetPeriodsPerMonth: null };
      const n = finite(value);
      return n !== null && n > 0 ? { budgetPeriodsPerMonth: n } : null;
    }
    case "bonusMonth":
    case "bonusDayOfMonth": {
      if (value.trim() === "") return { [field]: null };
      const n = finite(value);
      const max = field === "bonusMonth" ? 12 : 31;
      return n !== null && Number.isInteger(n) && n >= 1 && n <= max
        ? { [field]: n }
        : null;
    }
    // The bonus pay date is two fields of one entry — one write, so the
    // second can't overwrite the first. "MM-DD", or "" to clear.
    case "bonusDate": {
      if (value === "") return { bonusMonth: null, bonusDayOfMonth: null };
      const [m, d] = value.split("-").map(Number);
      return m && d && m >= 1 && m <= 12 && d >= 1 && d <= 31
        ? { bonusMonth: m, bonusDayOfMonth: d }
        : null;
    }
    case "w4Box2cChecked":
      return { w4Box2cChecked: value === "true" };
    case "bonusDestination":
      return value === "budget" || value === "spending"
        ? { bonusDestination: value }
        : null;
    // A known payday, "YYYY-MM-DD"; "" = none (use the start date).
    case "anchorPayDate":
      if (value === "") return { anchorPayDate: null };
      return /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? { anchorPayDate: value }
        : null;
  }
  if (field in ENUM_FIELDS) {
    const parsed =
      ENUM_FIELDS[field as keyof typeof ENUM_FIELDS].safeParse(value);
    return parsed.success
      ? ({ [field]: parsed.data } as SalaryEntryFields)
      : null;
  }
  return undefined;
}
