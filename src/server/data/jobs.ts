/** The jobs table's own rows. */

import { calendarDateOf } from "@/lib/utils/calendar-date";

/**
 * A speculative job is a permanent, auto-provisioned peg for Salary
 * Profiles to pin what-if scenarios against (e.g. "moving to Chicago in 5
 * years") — never a real job. Every person gets exactly one (DB-enforced,
 * see `jobs_one_speculative_per_person_idx` in schema-pg.ts), and it must
 * never be treated as a person's real, active job — see
 * findActiveJob/filterActiveJobs in lib/pure/household/profiles.ts, the single source
 * of truth for that exclusion. Exported so demo-seed.ts and the 0013 migration
 * can use the identical placeholder shape.
 */
export function speculativeJobValues(personId: number, startedOn: Date) {
  return {
    personId,
    employerName: "Speculative (What-If Planning)",
    startDate: calendarDateOf(startedOn),
    isSpeculative: true,
  };
}
