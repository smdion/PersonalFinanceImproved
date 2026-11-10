// Create, duplicate, delete and make active for Contribution, Salary and
// Retirement Profiles, each kind keeping its router's own rules. Permission
// checks stay in each router's procedure type.
import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import {
  canDeleteContributionProfile,
  canDeleteRetirementProfile,
  canDeleteSalaryProfile,
} from "@/lib/pure/household/profiles";
import type { SalaryEntryMap } from "@/lib/pure/household/compensation";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import { resolveRetirementProfileIdFrom } from "@/lib/pure/household/retirement-profile";
import { storedInteger } from "@/lib/utils/stored-integer";
import {
  ACTIVE_SETTING_KEY,
  PROFILE_TABLE,
  assertNoPlanUses,
} from "@/server/services/profiles/plans";
import { upsertSetting } from "@/server/data/settings";
import { firstRow } from "@/lib/utils/first-row";
import type { Ack } from "@/lib/http/probe-result";

export type LifecycleKind = "contribution" | "salary" | "retirement";

type ContributionProfile = typeof schema.contributionProfiles.$inferSelect;
type SalaryProfile = typeof schema.salaryProfiles.$inferSelect;
type RetirementProfile = typeof schema.retirementProfiles.$inferSelect;
type ContributionActiveFields = ContributionProfile["contributionActiveFields"];

const CAN_DELETE = {
  contribution: canDeleteContributionProfile,
  salary: canDeleteSalaryProfile,
  retirement: canDeleteRetirementProfile,
} as const;

type ActiveSettingRow = typeof schema.appSettings.$inferSelect;

/** The active profile a delete must refuse. */
const ACTIVE_FOR_DELETE: Record<
  LifecycleKind,
  (settingRows: ActiveSettingRow[], profiles: { id: number }[]) => number | null
> = {
  // The stored setting, a number or a numeric string, as its readers take it.
  contribution: (rows) => storedInteger(rows[0]?.value, null),
  salary: (rows) => storedInteger(rows[0]?.value, null),
  // Resolved: unset or stale means the lowest id, the one the engine reads.
  retirement: (rows, profiles) =>
    resolveRetirementProfileIdFrom(rows, profiles),
};

/** Remove a profile's rows, once every guard has passed. */
const DELETE_ROWS: Record<
  LifecycleKind,
  (db: Db, id: number) => Promise<void>
> = {
  contribution: async (db, id) => {
    await db
      .delete(schema.contributionProfiles)
      .where(eq(schema.contributionProfiles.id, id));
  },
  salary: async (db, id) => {
    await db
      .delete(schema.salaryProfiles)
      .where(eq(schema.salaryProfiles.id, id));
  },
  // Child rows explicitly, not by ON DELETE cascade: SQLite installs
  // whose profile_id came from ALTER TABLE ADD COLUMN have no cascade.
  retirement: async (db, id) => {
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.retirementProfilePeople)
        .where(eq(schema.retirementProfilePeople.profileId, id));
      await tx
        .delete(schema.retirementSettings)
        .where(eq(schema.retirementSettings.profileId, id));
      await tx
        .delete(schema.retirementProfiles)
        .where(eq(schema.retirementProfiles.id, id));
    });
  },
};

// ── create ──

type NewProfile = { name: string; description?: string };

export function createProfile(
  db: Db,
  kind: "contribution",
  input: NewProfile & { contributionActiveFields: ContributionActiveFields },
): Promise<ContributionProfile>;
export function createProfile(
  db: Db,
  kind: "salary",
  input: NewProfile & { salaries?: SalaryEntryMap },
): Promise<SalaryProfile>;
/** Add a profile holding exactly what it was given (Salary: no entries when
 *  none are given, never copied from another profile). */
export async function createProfile(
  db: Db,
  kind: "contribution" | "salary",
  input: NewProfile & {
    contributionActiveFields?: ContributionActiveFields;
    salaries?: SalaryEntryMap;
  },
): Promise<ContributionProfile | SalaryProfile> {
  if (kind === "contribution") {
    const rows = await db
      .insert(schema.contributionProfiles)
      .values({
        name: input.name,
        description: input.description ?? null,
        contributionActiveFields: input.contributionActiveFields,
      })
      .returning();
    return rows[0]!;
  }
  const rows = await db
    .insert(schema.salaryProfiles)
    .values({
      name: input.name,
      description: input.description ?? null,
      salaries: input.salaries ?? {},
    })
    .returning();
  return rows[0]!;
}

// ── duplicate ──

type DuplicateInput = { sourceProfileId: number; name: string };

export function duplicateProfile(
  db: Db,
  kind: "contribution",
  input: DuplicateInput,
  checkCopy: (fields: ContributionActiveFields) => Promise<void>,
): Promise<ContributionProfile>;
export function duplicateProfile(
  db: Db,
  kind: "salary",
  input: DuplicateInput,
): Promise<SalaryProfile>;
export function duplicateProfile(
  db: Db,
  kind: "retirement",
  input: DuplicateInput & { description?: string },
): Promise<RetirementProfile>;
/** Add a new, inactive profile copied from another: Contribution verbatim
 *  (after `checkCopy`), Salary with every entry's extra-paycheck routing
 *  cleared, Retirement with each person's rows. */
export async function duplicateProfile(
  db: Db,
  kind: LifecycleKind,
  input: DuplicateInput & { description?: string },
  checkCopy?: (fields: ContributionActiveFields) => Promise<void>,
): Promise<ContributionProfile | SalaryProfile | RetirementProfile> {
  if (kind === "retirement") return duplicateRetirementProfile(db, input);
  if (kind === "contribution") {
    const source = await db
      .select()
      .from(schema.contributionProfiles)
      .where(eq(schema.contributionProfiles.id, input.sourceProfileId))
      .then(firstRow);
    if (!source) throw sourceNotFound();

    const contributionActiveFields = orEmpty(source.contributionActiveFields);
    await checkCopy?.(contributionActiveFields);

    const rows = await db
      .insert(schema.contributionProfiles)
      .values({
        name: input.name,
        description: source.description,
        contributionActiveFields,
      })
      .returning();
    return rows[0]!;
  }

  const source = await db
    .select()
    .from(schema.salaryProfiles)
    .where(eq(schema.salaryProfiles.id, input.sourceProfileId))
    .then(firstRow);
  if (!source) throw sourceNotFound();

  const sourceSalaries: SalaryEntryMap = orEmpty(source.salaries);
  const salaries: SalaryEntryMap = Object.fromEntries(
    Object.entries(sourceSalaries).map(([jobId, entry]) => [
      jobId,
      { ...entry, extraPaycheckRouting: null },
    ]),
  );

  const rows = await db
    .insert(schema.salaryProfiles)
    .values({
      name: input.name,
      description: source.description,
      salaries,
    })
    .returning();
  return rows[0]!;
}

/** A stored JSON `null` reads back as null although the column is NOT NULL. */
function orEmpty<T extends object>(stored: T | null): T | Record<never, never> {
  return stored ?? {};
}

function sourceNotFound(): TRPCError {
  return new TRPCError({
    code: "NOT_FOUND",
    message: "Source profile not found",
  });
}

/** Each person's own source rows into the new profile; the primary
 *  person's row for anyone with none of their own. */
function duplicateRetirementProfile(
  db: Db,
  input: DuplicateInput & { description?: string },
): Promise<RetirementProfile> {
  return db.transaction(async (tx) => {
    const people = await tx
      .select()
      .from(schema.people)
      .orderBy(asc(schema.people.id));
    if (people.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No people exist to seed the new profile with.",
      });
    }
    const primaryPerson = getPrimaryPerson(people);

    const sourceSettings = await tx
      .select()
      .from(schema.retirementSettings)
      .where(eq(schema.retirementSettings.profileId, input.sourceProfileId));
    const sourceHousehold =
      (primaryPerson
        ? sourceSettings.find((s) => s.personId === primaryPerson.id)
        : undefined) ?? sourceSettings[0];
    if (!sourceHousehold) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Source profile has no settings to clone.",
      });
    }

    const sourcePeopleRows = await tx
      .select()
      .from(schema.retirementProfilePeople)
      .where(
        eq(schema.retirementProfilePeople.profileId, input.sourceProfileId),
      );
    const sourcePrimaryPeopleRow =
      (primaryPerson
        ? sourcePeopleRows.find((r) => r.personId === primaryPerson.id)
        : undefined) ?? sourcePeopleRows[0];

    const [newProfile] = await tx
      .insert(schema.retirementProfiles)
      .values({
        name: input.name,
        description: input.description ?? null,
      })
      .returning();
    if (!newProfile) throw new Error("Failed to create profile.");

    const sourceSettingsByPerson = new Map(
      sourceSettings.map((s) => [s.personId, s]),
    );
    await tx.insert(schema.retirementSettings).values(
      people.map((p) => {
        const src = sourceSettingsByPerson.get(p.id) ?? sourceHousehold;
        const {
          id: _hhId,
          personId: _hhPersonId,
          profileId: _hhProfileId,
          ...fields
        } = src;
        return { ...fields, personId: p.id, profileId: newProfile.id };
      }),
    );

    if (sourcePrimaryPeopleRow) {
      const sourcePeopleByPerson = new Map(
        sourcePeopleRows.map((r) => [r.personId, r]),
      );
      await tx.insert(schema.retirementProfilePeople).values(
        people.map((p) => {
          const src = sourcePeopleByPerson.get(p.id) ?? sourcePrimaryPeopleRow;
          const {
            id: _ppId,
            personId: _ppPersonId,
            profileId: _ppProfileId,
            ...fields
          } = src;
          return { ...fields, personId: p.id, profileId: newProfile.id };
        }),
      );
    }

    return newProfile;
  });
}

// ── delete ──

/** Refused, in this order: the last profile, the active one, one that
 *  doesn't exist, one a Plan uses (Plan columns are ON DELETE set null). */
export async function deleteProfile(
  db: Db,
  kind: LifecycleKind,
  id: number,
): Promise<Ack> {
  const activeSettingRows = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, ACTIVE_SETTING_KEY[kind]));

  const table = PROFILE_TABLE[kind];
  const allProfiles = await db.select({ id: table.id }).from(table);
  const activeId = ACTIVE_FOR_DELETE[kind](activeSettingRows, allProfiles);

  const deleteCheck = CAN_DELETE[kind](activeId, id, allProfiles.length);
  if (!deleteCheck.allowed)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: deleteCheck.reason ?? "This profile can't be deleted.",
    });

  if (!allProfiles.some((p) => p.id === id))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Profile not found",
    });

  await assertNoPlanUses(db, kind, id);

  await DELETE_ROWS[kind](db, id);
  return { ok: true };
}

// ── make active ──

/** Make a profile the active one; `null` deletes the setting's row (its
 *  value is NOT NULL), leaving no active profile. */
export async function setActiveProfile(
  db: Db,
  kind: "contribution" | "salary",
  id: number | null,
): Promise<Ack> {
  const key = ACTIVE_SETTING_KEY[kind];
  if (id === null) {
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
    return { ok: true };
  }

  const table = PROFILE_TABLE[kind];
  const [profile] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, id));
  if (!profile)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Profile not found",
    });

  await upsertSetting(db, key, id);
  return { ok: true };
}
