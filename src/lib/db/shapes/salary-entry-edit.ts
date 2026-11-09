/**
 * Maps one salary-editor field edit (Paycheck page, Profiles → Salary; string values) to the
 * Salary Profile entry fields it sets, each checked against salaryEntrySchema's own field.
 * Both editors send the result to salaryProfile.patchEntry.
 */
import { salaryEntrySchema } from "@/lib/db/shapes/json-schemas";
import { isMonthDay } from "@/lib/utils/date";
import type { z } from "zod/v4";

/** Entry fields an edit can set. */
type SalaryEntryFields = Partial<z.infer<typeof salaryEntrySchema>>;

type EntryField = keyof typeof salaryEntrySchema.shape;

/** Editor field names that aren't the entry's own name. */
const RENAMED: Record<string, EntryField> = { annualSalary: "salary" };

/** Fields whose blank value means "none" (null). */
const BLANK_IS_NULL = new Set<EntryField>([
  "bonusOverride",
  "budgetPeriodsPerMonth",
  "bonusMonth",
  "bonusDayOfMonth",
  "anchorPayDate",
]);

/** Fields entered as text (the rest are numbers or a switch). */
const TEXT_FIELDS = new Set<EntryField>([
  "payPeriod",
  "payWeek",
  "w4FilingStatus",
  "anchorPayDate",
  "bonusDestination",
]);

/** One field, checked against the schema; null when the value is refused. */
function checked(field: EntryField, value: unknown): SalaryEntryFields | null {
  const parsed = salaryEntrySchema.shape[field].safeParse(value);
  return parsed.success
    ? ({ [field]: parsed.data } as SalaryEntryFields)
    : null;
}

/**
 * `undefined`: not a Salary Profile field; `null`: invalid value, save nothing; otherwise the
 * fields to patch. `otherEarnings` (the job's other-pay amounts) keeps the lines not edited.
 */
export function salaryEntryEdit(
  field: string,
  value: string,
  ctx: { otherEarnings: Record<string, number> } = { otherEarnings: {} },
): SalaryEntryFields | null | undefined {
  if (field.startsWith("otherEarnings:")) {
    const n = value.trim() === "" ? NaN : Number(value);
    return checked("otherEarnings", {
      ...ctx.otherEarnings,
      [field.slice("otherEarnings:".length)]: n,
    });
  }
  // The bonus pay date is two fields of one entry — one write, so the
  // second can't overwrite the first. "MM-DD", or "" to clear.
  if (field === "bonusDate") {
    if (value === "") return { bonusMonth: null, bonusDayOfMonth: null };
    const [m, d] = value.split("-").map(Number);
    return m !== undefined && d !== undefined && isMonthDay(m, d)
      ? { bonusMonth: m, bonusDayOfMonth: d }
      : null;
  }
  const name = (RENAMED[field] ?? field) as EntryField;
  if (!(name in salaryEntrySchema.shape) || name === "otherEarnings")
    return undefined;
  // Not editable as one field: the routing has its own editor.
  if (name === "extraPaycheckRouting") return undefined;
  if (value.trim() === "" && BLANK_IS_NULL.has(name))
    return checked(name, null);
  if (name === "w4Box2cChecked") return checked(name, value === "true");
  if (TEXT_FIELDS.has(name)) return checked(name, value);
  return value.trim() === "" ? null : checked(name, Number(value));
}
