/** The pay a contribution row runs on: its per-check schedule, and the household's joint rows. */
import type { AccountOwnership } from "@/lib/config/enum-values";
import { getPeriodsPerYear } from "@/lib/config/pay-periods";
import type { JobRef } from "./contribution-rows";

/** A joint row the household pays; a joint row tied to a job sits in that job's rows. */
export function isHouseholdJointRow(row: {
  ownership: AccountOwnership;
  jobId: number | null;
}): boolean {
  return row.ownership === "joint" && row.jobId === null;
}

/** A row's job and per-check pay schedule: its own job's; with no job, its person's; a household
 *  joint row, the one schedule all active jobs share. `incomplete` ($0, flagged): a per-check row
 *  with none, or a joint percent (no pay of its own). `periodsPerYear` 0 is never divided by. */
export function rowPaySchedule<J extends JobRef>(
  row: {
    contributionMethod?: string | null;
    jobId: number | null;
    personId: number | null;
    ownership: AccountOwnership;
  },
  activeJobs: readonly J[],
): { periodsPerYear: number; incomplete: boolean; job: J | undefined } {
  const joint = isHouseholdJointRow(row);
  const jobs =
    row.jobId !== null
      ? activeJobs.filter((j) => j.id === row.jobId)
      : joint
        ? activeJobs
        : activeJobs.filter((j) => j.personId === row.personId).slice(0, 1);
  const schedules = new Set(jobs.flatMap((j) => j.payPeriod ?? []));
  const [only] = schedules;
  const periodsPerYear =
    only !== undefined && schedules.size === 1 ? getPeriodsPerYear(only) : 0;
  const incomplete =
    (periodsPerYear === 0 && row.contributionMethod === "fixed_per_period") ||
    (joint && row.contributionMethod === "percent_of_salary");
  return { periodsPerYear, incomplete, job: joint ? undefined : jobs[0] };
}
