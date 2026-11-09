import { isNull, asc, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { SK_ACTIVE_RETIREMENT_PROFILE_ID } from "@/lib/constants/settings-keys";
import { lockForTransaction } from "@/server/data/lock-row";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import type { DbOrTx, Db } from "@/lib/db";
import { upsertSetting } from "@/server/data/settings";

/** The name of an install's first Retirement profile. */
export const FIRST_RETIREMENT_PROFILE_NAME = "Current Retirement";

/** Held by whatever may create the first profile, inside its transaction. */
export function lockFirstRetirementProfile(tx: DbOrTx): Promise<void> {
  return lockForTransaction(tx, "first-retirement-profile");
}

/**
 * Give an install with saved retirement settings but no Retirement profile its first one,
 * "Current Retirement", adopting unassigned settings rows and every person, and make it active.
 * No-op once a profile exists or before any settings are saved; returns the new id or null.
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
    await upsertSetting(tx, SK_ACTIVE_RETIREMENT_PROFILE_ID, profileId);
    return profileId;
  });
}

/**
 * Completeness invariant: give a person with no rows in a profile its `retirement_settings` and
 * `retirement_profile_people` rows, cloned from the primary person's (else the lowest id's) with
 * person and profile swapped. Skips a table the profile has no row in.
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
