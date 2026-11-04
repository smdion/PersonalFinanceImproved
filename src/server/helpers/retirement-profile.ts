/**
 * Which Retirement Profile is active, resolved server-side.
 *
 * Retirement is the fourth profile axis alongside budget / contribution /
 * salary. On the client those resolve through `useEffectiveProfileId`
 * (Plan's choice → local selection → global active); server-side reads get
 * handed an id or fall back to the global active one, which is what this
 * does.
 *
 * ONE resolver, used by every read site (build-engine-payload, snapshot,
 * the retirement router), so "which assumptions am I reading" can't diverge
 * between the projection, the net-worth history, and the readiness analysis.
 *
 * Each profile is a complete world — there is no baseline profile and no
 * merging. This returns exactly one id, and the caller reads that profile's
 * rows and nothing else.
 */
import { planRetirementYear } from "@/lib/pure/household-timeline";
import { projectionJobs } from "@/lib/pure/profiles";
import { asc, eq, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { SK_ACTIVE_RETIREMENT_PROFILE_ID } from "@/lib/constants/settings-keys";
import { lockForTransaction } from "./transaction-lock";
import { getPrimaryPerson } from "./transforms";
import type { Db, DbOrTx } from "@/lib/db";

/** Coerce an app_settings jsonb value to a profile id. Stored as a bare
 *  number (`1`), but tolerate a numeric string from older writes. */
function toProfileId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

/**
 * Resolve the active profile id from already-loaded rows — the hot path, so
 * callers that already selected these tables don't issue extra queries.
 *
 * Falls back to the lowest-id profile when the setting is missing or points
 * at a deleted row. That fallback matters: without it a household whose
 * setting went stale resolves to no profile, and `buildEnginePayload`
 * returns null, which blanks the retirement page rather than degrading.
 */
export function resolveRetirementProfileIdFrom(
  appSettings: { key: string; value: unknown }[],
  profiles: { id: number }[],
): number | null {
  if (profiles.length === 0) return null;
  const validIds = new Set(profiles.map((p) => p.id));
  const configured = toProfileId(
    appSettings.find((s) => s.key === SK_ACTIVE_RETIREMENT_PROFILE_ID)?.value,
  );
  if (configured != null && validIds.has(configured)) return configured;
  return profiles.reduce((lowest, p) => (p.id < lowest.id ? p : lowest)).id;
}

/** Whether resolveRetirementProfileIdFrom had to fall back: there are
 *  profiles, but the setting doesn't name one of them. */
export function retirementProfileIsFallback(
  appSettings: { key: string; value: unknown }[],
  profiles: { id: number }[],
): boolean {
  const configured = toProfileId(
    appSettings.find((s) => s.key === SK_ACTIVE_RETIREMENT_PROFILE_ID)?.value,
  );
  return profiles.length > 0 && !profiles.some((p) => p.id === configured);
}

/**
 * Pick the one settings row that represents a profile's household assumptions.
 *
 * During the EXPAND phase `retirement_settings` is still one row per person,
 * and step A pointed every one of them at the same profile — so filtering by
 * `profileId` alone matches several rows, and the underlying SELECT has no
 * ORDER BY, so `.find()` would pick an arbitrary one.
 *
 * That is not academic. Household-grain columns are duplicated onto every
 * person's row and are free to DISAGREE, because only the primary person's
 * copy was ever read — a real household here had `withdrawal_rate` 0.0325 vs
 * 0.04 and `rmd_excess_handling` reinvest vs spend across its two rows.
 * Picking the wrong one silently moves every number in the projection
 * (caught by the golden gate, which is the whole reason it exists).
 *
 * So: prefer the primary person's row, exactly as the pre-migration code did.
 * Once the contract step collapses this to one row per profile, THAT row must
 * be built from the primary person's values for the same reason.
 */
export function pickProfileSettingsRow<
  T extends { profileId: number | null; personId: number },
>(
  rows: T[],
  profileId: number | null,
  primaryPersonId: number | null,
): T | undefined {
  if (profileId == null) {
    return primaryPersonId != null
      ? rows.find((r) => r.personId === primaryPersonId)
      : rows[0];
  }
  const inProfile = rows.filter((r) => r.profileId === profileId);
  return (
    (primaryPersonId != null
      ? inProfile.find((r) => r.personId === primaryPersonId)
      : undefined) ??
    // Deterministic fallback — lowest personId, never array order.
    inProfile.reduce<T | undefined>(
      (best, r) => (best == null || r.personId < best.personId ? r : best),
      undefined,
    )
  );
}

/** Query-issuing convenience wrapper for callers that haven't already
 *  loaded app_settings and retirement_profiles. */
export async function resolveRetirementProfileId(
  db: DbOrTx,
): Promise<number | null> {
  // One after the other: callers pass open transactions, and a
  // PostgreSQL client runs one query at a time.
  const appSettings = await db.select().from(schema.appSettings);
  const profiles = await db
    .select()
    .from(schema.retirementProfiles)
    .orderBy(asc(schema.retirementProfiles.id));
  return resolveRetirementProfileIdFrom(appSettings, profiles);
}

/** The name of an install's first Retirement profile. */
export const FIRST_RETIREMENT_PROFILE_NAME = "Current Retirement";

/** Held by whatever may create the first profile, inside its transaction. */
export function lockFirstRetirementProfile(tx: DbOrTx): Promise<void> {
  return lockForTransaction(tx, "first-retirement-profile");
}

/**
 * Give an install with saved retirement settings and no Retirement profile
 * its first one, in one transaction: "Current Retirement", every
 * `retirement_settings` row with no profile pointed at it, a
 * `retirement_profile_people` row from each of those, everyone else added
 * as `people.create` adds a person (addPersonToRetirementProfile), and
 * made active. Does nothing once any profile
 * exists, or before any settings are saved (a person's row needs an age).
 * Returns the new profile's id, or null when nothing changed.
 */
export async function adoptFirstRetirementProfile(
  db: DbOrTx,
): Promise<number | null> {
  return (db as Db).transaction(async (tx) => {
    // Two saves at once: the second waits here, then finds the profile.
    await lockFirstRetirementProfile(tx);
    const [anyProfile] = await tx
      .select({ id: schema.retirementProfiles.id })
      .from(schema.retirementProfiles)
      .limit(1);
    if (anyProfile) return null;
    const settings = await tx
      .select()
      .from(schema.retirementSettings)
      .where(isNull(schema.retirementSettings.profileId))
      .orderBy(asc(schema.retirementSettings.personId));
    if (settings.length === 0) return null;

    const people = await tx
      .select()
      .from(schema.people)
      .orderBy(asc(schema.people.id));
    const primary = getPrimaryPerson(people);
    const byPerson = new Map(settings.map((s) => [s.personId, s]));

    const [profile] = await tx
      .insert(schema.retirementProfiles)
      .values({ name: FIRST_RETIREMENT_PROFILE_NAME })
      .returning({ id: schema.retirementProfiles.id });
    const profileId = profile!.id;
    await tx
      .update(schema.retirementSettings)
      .set({ profileId })
      .where(isNull(schema.retirementSettings.profileId));
    await tx.insert(schema.retirementProfilePeople).values(
      settings.map((src) => ({
        profileId,
        personId: src.personId,
        retirementAge: src.retirementAge,
        endAge: src.endAge,
        socialSecurityMonthly: src.socialSecurityMonthly,
        ssStartAge: src.ssStartAge,
      })),
    );
    for (const p of people)
      if (!byPerson.has(p.id))
        await addPersonToRetirementProfile(tx, profileId, p.id, primary?.id);
    await tx
      .insert(schema.appSettings)
      .values({ key: SK_ACTIVE_RETIREMENT_PROFILE_ID, value: profileId })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: profileId },
      });
    return profileId;
  });
}

/**
 * Completeness invariant: give a person with no rows in a profile that
 * profile's rows, a `retirement_settings` row and a
 * `retirement_profile_people` row, each cloned from the primary person's
 * row in it (else the lowest person id's), with person and profile swapped.
 * Skips a table the profile has no row in to clone.
 */
export async function addPersonToRetirementProfile(
  tx: DbOrTx,
  profileId: number,
  personId: number,
  primaryPersonId: number | undefined,
): Promise<void> {
  const settingsRows = await tx
    .select()
    .from(schema.retirementSettings)
    .where(eq(schema.retirementSettings.profileId, profileId))
    .orderBy(asc(schema.retirementSettings.personId));
  const sourceHousehold =
    settingsRows.find((s) => s.personId === primaryPersonId) ?? settingsRows[0];
  if (sourceHousehold) {
    const {
      id: _hhId,
      personId: _hhPersonId,
      profileId: _hhProfileId,
      ...householdFields
    } = sourceHousehold;
    await tx
      .insert(schema.retirementSettings)
      .values({ ...householdFields, personId, profileId });
  }

  const peopleRows = await tx
    .select()
    .from(schema.retirementProfilePeople)
    .where(eq(schema.retirementProfilePeople.profileId, profileId))
    .orderBy(asc(schema.retirementProfilePeople.personId));
  const sourcePersonRow =
    peopleRows.find((r) => r.personId === primaryPersonId) ?? peopleRows[0];
  if (sourcePersonRow) {
    const {
      id: _ppId,
      personId: _ppPersonId,
      profileId: _ppProfileId,
      ...perPersonFields
    } = sourcePersonRow;
    await tx
      .insert(schema.retirementProfilePeople)
      .values({ ...perPersonFields, personId, profileId });
  }
}

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
export async function householdRetirementYear(db: Db): Promise<number | null> {
  const [planned, jobs] = await Promise.all([
    plannedRetirements(db),
    db.select().from(schema.jobs),
  ]);
  if (planned.length === 0) return null;
  return planRetirementYear(
    planned,
    projectionJobs(jobs, new Date()).map((j) => j.personId),
  );
}
