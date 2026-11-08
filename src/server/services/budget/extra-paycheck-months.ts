/** The month walk both extra-paycheck materializers share. Savings and
 *  Budget mode split every job by `isExtraPaycheckBudgetMode`, so each job
 *  is walked by exactly one of them. */

import * as schema from "@/lib/db/schema";
import type { SalaryEntry } from "@/lib/db/salary-entry-defaults";
import {
  getExtraPaycheckMonthKeys,
  isExtraPaycheckBudgetMode,
} from "@/lib/pure/paycheck/extra-paycheck-months";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import { calendarDateOf } from "@/lib/utils/calendar-date";
import type { Db } from "@/lib/db";

/** Months walked from the current one: the 10-year projection window. */
const HORIZON_MONTHS = 120;

export type ExtraPaycheckMode = "savings" | "budget";

export type ExtraPaycheckJob = {
  id: number;
  personId: number;
  routing: SalaryEntry["extraPaycheckRouting"];
  /** `YYYY-MM-01` of each month with an extra paycheck, in order. */
  monthDates: string[];
};

/**
 * Every current, non-speculative job in `mode`, in the order the jobs table
 * returns them, with its extra-paycheck months from `now`'s month on. A job
 * with no pay schedule (anchor date or pay period) is left out.
 */
export async function loadExtraPaycheckJobs(
  db: Db,
  now: Date,
  mode: ExtraPaycheckMode,
): Promise<ExtraPaycheckJob[]> {
  const allJobs = await db
    .select({
      id: schema.jobs.id,
      personId: schema.jobs.personId,
      endDate: schema.jobs.endDate,
      isSpeculative: schema.jobs.isSpeculative,
    })
    .from(schema.jobs);
  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(db, null);

  const todayStr = calendarDateOf(now);
  const jobs: ExtraPaycheckJob[] = [];
  for (const job of allJobs) {
    if (job.isSpeculative) continue;
    const entry = salaryProfileActiveMap.get(job.id);
    const routing = entry?.extraPaycheckRouting ?? null;
    if (isExtraPaycheckBudgetMode(routing) !== (mode === "budget")) continue;
    if (job.endDate && job.endDate < todayStr) continue;
    // The schedule saved with the routing wins (its `null` anchor included);
    // routing saved without one reads the job's live Salary Profile entry.
    const anchorPayDate =
      routing?.anchorPayDate !== undefined
        ? routing.anchorPayDate
        : (entry?.anchorPayDate ?? null);
    const payPeriod = routing?.payPeriod ?? entry?.payPeriod;
    if (!anchorPayDate || !payPeriod) continue;
    jobs.push({
      id: job.id,
      personId: job.personId,
      routing,
      monthDates: getExtraPaycheckMonthKeys(
        new Date(anchorPayDate + "T00:00:00Z"),
        payPeriod,
        now,
        HORIZON_MONTHS,
      ),
    });
  }
  return jobs;
}
