import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";
import type { Db } from "@/lib/db";

/**
 * Fetch a Salary Profile by id.
 *
 * A null/undefined id means "no Salary Profile selected at this call site"
 * and yields null. A non-null id that doesn't resolve is a genuinely
 * missing row, not a sentinel.
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
  return rows[0] ?? null;
}

/**
 * Resolve just the id of the globally-active Salary Profile (the same
 * app_settings lookup loadEffectiveSalaryProfile does internally), for
 * callers that need the id itself to write back into that profile's row —
 * not just its resolved job map. See savings.ts's extraPaycheckRouting
 * sub-router, which reads/writes a single job's entry within this row.
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
