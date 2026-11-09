import { and, inArray, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { W4FilingStatus } from "@/lib/config/filing-status";
import type { Db } from "@/lib/db";
import {
  applySalaryProfileRow,
  type SalaryProfileActiveMap,
} from "@/lib/pure/household/compensation";
import {
  fetchSalaryProfile,
  resolveActiveSalaryProfileId,
} from "@/server/data/salaries";

/**
 * Load a Salary Profile's job-targeted active-value map (SalaryProfileActiveMap); empty when the
 * id is null/undefined or the profile doesn't exist.
 */
export async function loadAndApplySalaryProfile(
  db: Db,
  salaryProfileId: number | undefined | null,
): Promise<SalaryProfileActiveMap> {
  const profile = await fetchSalaryProfile(db, salaryProfileId);
  return applySalaryProfileRow(profile);
}

/**
 * loadAndApplySalaryProfile, falling back to the active Salary Profile when
 * no id is given: for callers that aren't showing a profile of their own.
 */
export async function loadEffectiveSalaryProfile(
  db: Db,
  salaryProfileId: number | null | undefined,
): Promise<SalaryProfileActiveMap> {
  if (salaryProfileId != null) {
    return loadAndApplySalaryProfile(db, salaryProfileId);
  }
  const activeId = await resolveActiveSalaryProfileId(db);
  return activeId != null ? loadAndApplySalaryProfile(db, activeId) : new Map();
}

/**
 * W-4 filing status of the first of `personIds` with a non-speculative job in `asOf`'s year, from
 * the request's Salary Profile (What-If included) or the active one; null if none. Only a
 * stand-in for the household's filing status (a W-4 status is a withholding choice).
 */
export async function w4FilingStatusOf(
  db: Db,
  personIds: readonly number[],
  asOf: Date,
  salaryProfileActiveMap?: SalaryProfileActiveMap,
): Promise<W4FilingStatus | null> {
  if (personIds.length === 0) return null;
  // Jobs held this year: current ones, then any that ended this year
  // (latest first) — someone retired mid-year still filed that way.
  const yearStart = `${asOf.getFullYear()}-01-01`;
  const jobs = (
    await db
      .select({
        id: schema.jobs.id,
        personId: schema.jobs.personId,
        endDate: schema.jobs.endDate,
      })
      .from(schema.jobs)
      .where(
        and(
          inArray(schema.jobs.personId, [...personIds]),
          eq(schema.jobs.isSpeculative, false),
        ),
      )
  )
    .filter((j) => j.endDate == null || String(j.endDate) >= yearStart)
    .sort(
      (a, b) =>
        Number(a.endDate != null) - Number(b.endDate != null) ||
        String(b.endDate ?? "").localeCompare(String(a.endDate ?? "")),
    );
  if (jobs.length === 0) return null;
  const active =
    salaryProfileActiveMap ?? (await loadEffectiveSalaryProfile(db, null));
  for (const personId of personIds)
    for (const job of jobs.filter((j) => j.personId === personId)) {
      const status = active.get(job.id)?.w4FilingStatus;
      if (status) return status;
    }
  return null;
}
