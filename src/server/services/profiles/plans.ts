/**
 * Plans: a named set of profiles, one per kind, with no values of its own. Applying one makes its
 * profiles active; the Plan in use is derived, never stored (the last applied is remembered only
 * so the header can offer "Update ‹Plan›").
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { SK_LAST_APPLIED_PLAN_ID } from "@/lib/constants/settings-keys";
import {
  PLAN_PROFILE_COLUMN,
  PLAN_PROFILE_KIND_LABELS,
  type PlanProfileIds,
  type PlanProfileKind,
} from "@/lib/config/plans";
import {
  planChanges,
  planInUseMessage,
  planProfileIds,
} from "@/lib/pure/household/plans";
import { resolveRetirementProfileIdFrom } from "@/lib/pure/household/retirement-profile";
import type { Permission } from "@/lib/config/permissions";
import type { Db } from "@/lib/db";
import { upsertSetting } from "@/server/data/settings";
import {
  ACTIVE_SETTING_KEY,
  activeProfileIdFrom,
} from "@/server/data/active-profile";

/** Who may make a profile of each kind active — the rule that kind's own
 *  "make active" enforces (budget.setActiveProfile, contributionProfile /
 *  salaryProfile.setActive, the admin-only app setting for retirement). */
const SET_ACTIVE_PERMISSION: Record<PlanProfileKind, Permission | "admin"> = {
  budget: "budget",
  contribution: "contributionProfile",
  salary: "contributionProfile",
  retirement: "admin",
};

export const PROFILE_TABLE = {
  budget: schema.budgetProfiles,
  contribution: schema.contributionProfiles,
  salary: schema.salaryProfiles,
  retirement: schema.retirementProfiles,
} as const;

/**
 * Refuse to delete a profile any Plan uses. The Plan columns are
 * `ON DELETE set null`, so without this a delete would silently empty that
 * slot of every Plan using it.
 */
export async function assertNoPlanUses(
  db: Db,
  kind: PlanProfileKind,
  profileId: number,
): Promise<void> {
  const plans = await db
    .select({ name: schema.scenarios.name })
    .from(schema.scenarios)
    .where(eq(schema.scenarios[PLAN_PROFILE_COLUMN[kind]], profileId));
  if (plans.length === 0) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: planInUseMessage(
      kind,
      plans.map((p) => p.name),
    ),
  });
}

/** The active profile of each kind, as the server resolves it. */
async function readActiveProfileIds(db: Db): Promise<PlanProfileIds> {
  const [settings, retirementProfiles, activeBudget] = await Promise.all([
    db.select().from(schema.appSettings),
    db
      .select({ id: schema.retirementProfiles.id })
      .from(schema.retirementProfiles),
    db
      .select({ id: schema.budgetProfiles.id })
      .from(schema.budgetProfiles)
      .where(eq(schema.budgetProfiles.isActive, true)),
  ]);
  return {
    salary: activeProfileIdFrom(settings, "salary"),
    contribution: activeProfileIdFrom(settings, "contribution"),
    budget: activeBudget[0]?.id ?? null,
    retirement: resolveRetirementProfileIdFrom(settings, retirementProfiles),
  };
}

/**
 * Make a Plan's profiles active in one transaction. Only kinds that would change are written and
 * permission-checked (an empty slot is left alone), all before any write, so a refusal never
 * half-applies a Plan. The change log records `changedBy`, in the same transaction.
 */
export async function applyPlan(
  db: Db,
  user: { role: string; permissions: readonly string[] },
  planId: number,
  changedBy: string,
): Promise<void> {
  const [plan] = await db
    .select()
    .from(schema.scenarios)
    .where(eq(schema.scenarios.id, planId));
  if (!plan)
    throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });

  const targets = planChanges(
    planProfileIds(plan),
    await readActiveProfileIds(db),
  );

  const missing = targets
    .filter(({ kind }) => {
      // Same rule as request-scope.ts userHasPermission: admins hold every permission.
      const needed = SET_ACTIVE_PERMISSION[kind];
      if (user.role === "admin") return false;
      return needed === "admin" || !user.permissions.includes(needed);
    })
    .map(({ kind }) => PLAN_PROFILE_KIND_LABELS[kind]);
  if (missing.length > 0)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Applying this Plan changes your active ${missing.join(", ")} profile, which you don't have permission to change.`,
    });

  await db.transaction(async (tx) => {
    for (const { kind, id } of targets) {
      const table = PROFILE_TABLE[kind];
      const [exists] = await tx
        .select({ id: table.id })
        .from(table)
        .where(eq(table.id, id));
      if (!exists)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `This Plan's ${PLAN_PROFILE_KIND_LABELS[kind]} profile no longer exists.`,
        });
      if (kind === "budget") {
        await tx.update(schema.budgetProfiles).set({ isActive: false });
        await tx
          .update(schema.budgetProfiles)
          .set({ isActive: true })
          .where(eq(schema.budgetProfiles.id, id));
      } else {
        await upsertSetting(tx, ACTIVE_SETTING_KEY[kind], id);
      }
    }
    await upsertSetting(tx, SK_LAST_APPLIED_PLAN_ID, plan.id);
    // A protectedProcedure gets no change-log entry from tRPC: written here.
    await tx.insert(schema.changeLog).values({
      tableName: "settings.scenarios.activate",
      recordId: plan.id,
      fieldName: "*",
      oldValue: null,
      newValue: { id: plan.id, name: plan.name },
      changedBy,
    });
  });
}
