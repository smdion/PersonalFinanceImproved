/**
 * salary_profiles.salaries as read: checked once against the entry schema;
 * a row the check refuses is logged and read as stored (any install loads).
 */
import { salaryEntriesSchema } from "@/lib/db/json-schemas";
import type { SalaryEntry } from "@/lib/db/salary-entry-defaults";
import { log } from "@/lib/logger";

type SalaryProfileRow = {
  id: number;
  salaries: Record<string, SalaryEntry> | null;
};

/** The row with its entries checked: `{}` when it holds none. */
export function checkSalaryEntries<R extends SalaryProfileRow>(
  row: R,
): Omit<R, "salaries"> & { salaries: Record<string, SalaryEntry> } {
  const issues = salaryEntriesSchema.safeParse(row.salaries).error?.issues;
  if (issues)
    log("warn", "salary_entries_unexpected_shape", {
      profileId: row.id,
      issues: issues
        .slice(0, 10)
        .map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  return { ...row, salaries: row.salaries ?? {} };
}
