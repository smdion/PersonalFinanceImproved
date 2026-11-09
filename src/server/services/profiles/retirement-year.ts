import { planRetirementYear } from "@/lib/pure/household/household-timeline";
import { projectionJobs } from "@/lib/pure/household/profiles";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import { resolveRetirementProfileId } from "@/server/data/retirement-profiles";

/** Each person's birth year and planned retirement age under the active
 *  retirement profile (the profile's per-person age, else the person's
 *  settings row); people without either are left out. */
async function plannedRetirements(db: Db) {
  const [profileId, people, profilePeople, settings] = await Promise.all([
    resolveRetirementProfileId(db),
    db.select().from(schema.people),
    db.select().from(schema.retirementProfilePeople),
    db.select().from(schema.retirementSettings),
  ]);
  return people.flatMap((p) => {
    const born = Number(String(p.dateOfBirth).slice(0, 4));
    if (!(born > 1900)) return [];
    const age =
      profilePeople.find(
        (r) => r.profileId === profileId && r.personId === p.id,
      )?.retirementAge ??
      settings.find(
        (r) =>
          r.personId === p.id &&
          (profileId === null || r.profileId === profileId),
      )?.retirementAge;
    // Only the active profile's own rows: another profile's age is another
    // world's plan (each profile stands alone).
    return age != null
      ? [{ personId: p.id, birthYear: born, retirementAge: age }]
      : [];
  });
}

/**
 * The first year of withdrawals under the active retirement profile, as the
 * engine counts it (planRetirementYear). Null when nobody has a planned age.
 */
export async function householdRetirementYear(db: Db, asOf: Date) {
  const [planned, jobs] = await Promise.all([
    plannedRetirements(db),
    db.select().from(schema.jobs),
  ]);
  if (planned.length === 0) return null;
  return planRetirementYear(
    planned,
    projectionJobs(jobs, asOf).map((j) => j.personId),
  );
}
