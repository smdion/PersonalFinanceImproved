/**
 * salary_profiles.salaries as read: checked once against the entry schema;
 * the stored-JSON migration converts or refuses every row, so a row the
 * check refuses (a hand edit since) throws, naming the profile.
 */
import { salaryEntriesSchema } from "@/lib/db/shapes/json-schemas";
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import { readStoredShape } from "@/lib/db/stored-shape";

type SalaryProfileRow = {
  id: number;
  salaries: Record<string, SalaryEntry>;
};

/** The row with its entries checked; throws on entries of another shape. */
export function checkSalaryEntries<R extends SalaryProfileRow>(
  row: R,
): Omit<R, "salaries"> & { salaries: Record<string, SalaryEntry> } {
  const read = readStoredShape(row.salaries, salaryEntriesSchema, {
    event: "salary_entries_unexpected_shape",
    key: (issues) => `${row.id}|${issues.slice(0, 10)}`,
    data: (issues) => ({ profileId: row.id, issues: issues.slice(0, 10) }),
  });
  if (!read.fits)
    throw new Error(
      `Salary Profile ${row.id}: its stored entries don't fit their shape`,
    );
  return { ...row, salaries: read.value };
}
