/** The jobs table's own rows. */

import { calendarDateOf } from "@/lib/utils/calendar-date";

/**
 * A person's speculative job: a placeholder Salary Profiles pin what-if scenarios to,
 * one per person (`jobs_one_speculative_per_person_idx`), never a real job (see
 * findActiveJob/filterActiveJobs). Shared with demo-seed.ts and the 0013 migration.
 */
export function speculativeJobValues(personId: number, startedOn: Date) {
  return {
    personId,
    employerName: "Speculative (What-If Planning)",
    startDate: calendarDateOf(startedOn),
    isSpeculative: true,
  };
}
