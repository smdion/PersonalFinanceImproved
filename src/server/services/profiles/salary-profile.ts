import { and, inArray, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { W4FilingStatus } from "@/lib/config/filing-status";
import type { Db } from "@/lib/db";
import {
  applySalaryProfileRow,
  type SalaryProfileActiveMap,
} from "@/server/helpers/salary";
import {
  fetchSalaryProfile,
  resolveActiveSalaryProfileId,
} from "@/server/data/salaries";

/**
 * Load a Salary Profile and build its job-targeted active-value map — see
 * SalaryProfileActiveMap. Returns an empty map when the id is null/undefined
 * or the profile no longer exists.
 */
export async function loadAndApplySalaryProfile(
  db: Db,
  salaryProfileId: number | undefined | null,
): Promise<SalaryProfileActiveMap> {
  const profile = await fetchSalaryProfile(db, salaryProfileId);
  return applySalaryProfileRow(profile);
}

/**
 * Same as loadAndApplySalaryProfile, but falls back to the globally-ACTIVE
 * Salary Profile when no explicit id is given — the "viewing a specific
 * profile" callers (Paycheck/Contribution pages) always pass their own
 * resolved id, so this only matters when a caller genuinely has no
 * preference (historical.ts, savings.ts, retirement.ts, services/contributions/
 * live-data.ts's loadLiveContribData all call this with `null` for
 * exactly that reason — call this instead of hand-rolling the app_settings
 * lookup again). helpers/snapshot.ts's buildYearEndHistory is the one
 * deliberate exception: it already has app_settings batch-fetched as part
 * of a larger Promise.all, so re-deriving the active id from that
 * in-memory array avoids a redundant query on a hot path.
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
 * The W-4 filing status of the first of `personIds` (in order) with an
 * non-speculative job held this year (current first, then one that ended
 * this year), from the request's Salary Profile (its
 * What-If included) when given, else the active one — null when none has
 * one. Only a stand-in for the household's filing status: a W-4 status is
 * a withholding choice.
 */
export async function w4FilingStatusOf(
  db: Db,
  personIds: readonly number[],
  salaryProfileActiveMap?: SalaryProfileActiveMap,
): Promise<W4FilingStatus | null> {
  if (personIds.length === 0) return null;
  // Jobs held this year: current ones, then any that ended this year
  // (latest first) — someone retired mid-year still filed that way.
  const yearStart = `${new Date().getFullYear()}-01-01`;
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
