/**
 * salary_profiles.salaries as read: checked once against the entry schema;
 * a row the check refuses is logged and read as stored (any install loads).
 */
import { salaryEntriesSchema } from "@/lib/db/shapes/json-schemas";
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import { passOnAsStored, readStoredShape } from "@/lib/db/stored-shape";

type SalaryProfileRow = {
  id: number;
  salaries: Record<string, SalaryEntry> | null;
};

/** The row with its entries checked: `{}` when it holds none. */
export function checkSalaryEntries<R extends SalaryProfileRow>(
  row: R,
): Omit<R, "salaries"> & { salaries: Record<string, SalaryEntry> } {
  const read = readStoredShape(row.salaries, salaryEntriesSchema, {
    event: "salary_entries_unexpected_shape",
    key: (issues) => `${row.id}|${issues.slice(0, 10)}`,
    data: (issues) => ({ profileId: row.id, issues: issues.slice(0, 10) }),
  });
  // A JSON-null root (no writer stores one) reads as no entries.
  const salaries =
    read.fits || read.asStored != null ? passOnAsStored(read) : {};
  return { ...row, salaries };
}
