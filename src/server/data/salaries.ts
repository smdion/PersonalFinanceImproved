import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";
import type { Db } from "@/lib/db";
import { checkSalaryEntries } from "@/lib/db/stored-salary-entries";

/**
 * Fetch a Salary Profile by id, its entries checked (checkSalaryEntries).
 *
 * A null/undefined id (none selected here) yields null; a non-null id that
 * doesn't resolve is a missing row, not a sentinel.
 */
export async function fetchSalaryProfile(
  db: Db,
  salaryProfileId: number | null | undefined,
): Promise<typeof schema.salaryProfiles.$inferSelect | null> {
  if (salaryProfileId == null) return null;
  const rows = await db
    .select()
    .from(schema.salaryProfiles)
    .where(eq(schema.salaryProfiles.id, salaryProfileId));
  return rows[0] ? checkSalaryEntries(rows[0]) : null;
}

/**
 * Just the id of the globally-active Salary Profile, for callers that write back into
 * that profile's row (e.g. savings.ts's extraPaycheckRouting).
 */
export async function resolveActiveSalaryProfileId(
  db: Db,
): Promise<number | null> {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID));
  const activeId = Number(rows[0]?.value ?? NaN);
  return Number.isFinite(activeId) ? activeId : null;
}
