// Delete and make active for Contribution, Salary and
// Retirement Profiles, each kind keeping its router's own rules (no
// permission checks: each router keeps its procedure type).
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import {
  canDeleteContribProfile,
  canDeleteRetirementProfile,
  canDeleteSalaryProfile,
} from "@/lib/pure/household/profiles";
import { resolveRetirementProfileIdFrom } from "@/lib/pure/household/retirement-profile";
import {
  ACTIVE_SETTING_KEY,
  PROFILE_TABLE,
  assertNoPlanUses,
} from "@/server/services/profiles/plans";
import { upsertSetting } from "@/server/data/settings";

export type LifecycleKind = "contribution" | "salary" | "retirement";

const CAN_DELETE = {
  contribution: canDeleteContribProfile,
  salary: canDeleteSalaryProfile,
  retirement: canDeleteRetirementProfile,
} as const;

type ActiveSettingRow = typeof schema.appSettings.$inferSelect;

function storedNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** The active profile a delete must refuse. */
const ACTIVE_FOR_DELETE: Record<
  LifecycleKind,
  (settingRows: ActiveSettingRow[], profiles: { id: number }[]) => number | null
> = {
  // The raw setting: only a stored number can equal a profile id.
  contribution: (rows) => storedNumber(rows[0]?.value),
  salary: (rows) => storedNumber(rows[0]?.value),
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

// ── delete ──

/** Refused, in this order: the last profile, the active one, one that
 *  doesn't exist, one a Plan uses (Plan columns are ON DELETE set null). */
export async function deleteProfile(
  db: Db,
  kind: LifecycleKind,
  id: number,
): Promise<{ success: boolean }> {
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
  return { success: true };
}

// ── make active ──

/** Make a profile the active one; `null` deletes the setting's row (its
 *  value is NOT NULL), leaving no active profile. */
export async function setActiveProfile(
  db: Db,
  kind: "contribution" | "salary",
  id: number | null,
): Promise<{ success: boolean }> {
  const key = ACTIVE_SETTING_KEY[kind];
  if (id === null) {
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
    return { success: true };
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
  return { success: true };
}
