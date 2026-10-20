/**
 * Plans — a named set of profiles, one of each kind.
 *
 * Each profile is its own world and only the active one counts. A Plan holds
 * no values of its own: applying it makes its profiles the active ones, the
 * same write each kind's own "make active" does. Which Plan is in use is
 * derived (the Plan whose profiles equal the active ones), never stored as a
 * second source of truth; the last applied Plan is remembered only so the
 * header can offer "Update ‹Plan›" after a profile is changed.
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_RETIREMENT_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
  SK_LAST_APPLIED_PLAN_ID,
} from "@/lib/constants/settings-keys";
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
} from "@/lib/pure/plans";
import { resolveRetirementProfileIdFrom } from "./retirement-profile";
import type { Permission } from "@/server/auth";
import type { Db } from "./transforms";

/** Who may make a profile of each kind active — the rule that kind's own
 *  "make active" enforces (budget.setActiveProfile, contributionProfile /
 *  salaryProfile.setActive, the admin-only app setting for retirement). */
const SET_ACTIVE_PERMISSION: Record<PlanProfileKind, Permission | "admin"> = {
  budget: "budget",
  contribution: "contributionProfile",
  salary: "contributionProfile",
  retirement: "admin",
};

const ACTIVE_SETTING_KEY = {
  contribution: SK_ACTIVE_CONTRIB_PROFILE_ID,
  salary: SK_ACTIVE_SALARY_PROFILE_ID,
  retirement: SK_ACTIVE_RETIREMENT_PROFILE_ID,
} as const;

const PROFILE_TABLE = {
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
  const setting = (key: string) => {
    const v = settings.find((s) => s.key === key)?.value;
    return typeof v === "number" ? v : v == null ? null : Number(v) || null;
  };
  return {
    salary: setting(SK_ACTIVE_SALARY_PROFILE_ID),
    contribution: setting(SK_ACTIVE_CONTRIB_PROFILE_ID),
    budget: activeBudget[0]?.id ?? null,
    retirement: resolveRetirementProfileIdFrom(settings, retirementProfiles),
  };
}

/**
 * Make a Plan's profiles the active ones, in one transaction. Only kinds
 * that would actually change are written — and only those need the same
 * permission as changing them by hand (a kind already active, or a slot an
 * older Plan left empty, is left alone). Checked before anything is
 * written, so a refusal never half-applies a Plan.
 */
export async function applyPlan(
  db: Db,
  user: { role: string; permissions: readonly string[] },
  planId: number,
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
      // Same rule as trpc.ts userHasPermission: admins hold every permission.
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
  });
}

async function upsertSetting(
  db: Pick<Db, "insert">,
  key: string,
  value: number,
): Promise<void> {
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
}
