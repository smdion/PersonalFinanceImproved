/**
 * Plans — a named set of profiles, one of each kind. Applying a Plan makes
 * its profiles the active ones (household-wide); deleting a profile a Plan
 * uses is refused.
 */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestCaller,
  createViewerSessionWithPermissions,
  seedBudgetProfile,
  seedContributionProfile,
  seedRetirementProfile,
  seedSalaryProfile,
  adminSession,
} from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import { applyPlan } from "@/server/helpers/plans";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_RETIREMENT_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
  SK_LAST_APPLIED_PLAN_ID,
} from "@/lib/constants/settings-keys";

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;

async function seedProfiles(db: Ctx["db"], suffix: string, active = false) {
  return {
    salaryProfileId: seedSalaryProfile(db, { name: `Salary ${suffix}` }),
    contributionProfileId: seedContributionProfile(db, {
      name: `Contrib ${suffix}`,
      isActive: false,
    }),
    budgetProfileId: await seedBudgetProfile(db, `Budget ${suffix}`, active),
    retirementProfileId: await seedRetirementProfile(db, `Retire ${suffix}`),
  };
}

function setting(db: Ctx["db"], key: string) {
  return db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .get()?.value;
}

describe("Plans", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await createTestCaller(adminSession);
  });
  afterEach(() => ctx.cleanup());

  it("creates a Plan from one profile of each kind", async () => {
    const ids = await seedProfiles(ctx.db, "A");
    const plan = await ctx.caller.settings.scenarios.create({
      name: "Lean year",
      ...ids,
    });
    expect(plan).toMatchObject({ name: "Lean year", ...ids });
  });

  it("requires all four profiles", async () => {
    const { salaryProfileId } = await seedProfiles(ctx.db, "A");
    await expect(
      // @ts-expect-error — the other three kinds are required
      ctx.caller.settings.scenarios.create({ name: "Half", salaryProfileId }),
    ).rejects.toThrow();
  });

  it("refuses a duplicate name, on create and rename", async () => {
    const ids = await seedProfiles(ctx.db, "A");
    await ctx.caller.settings.scenarios.create({ name: "One", ...ids });
    const two = await ctx.caller.settings.scenarios.create({
      name: "Two",
      ...ids,
    });
    await expect(
      ctx.caller.settings.scenarios.create({ name: "One", ...ids }),
    ).rejects.toThrow(/already exists/);
    await expect(
      ctx.caller.settings.scenarios.update({ id: two!.id, name: "One" }),
    ).rejects.toThrow(/already exists/);
    // Renaming to its own name is fine.
    await ctx.caller.settings.scenarios.update({ id: two!.id, name: "Two" });
  });

  it("activate makes the Plan's profiles the active ones and remembers it", async () => {
    await seedProfiles(ctx.db, "Current", true);
    const ids = await seedProfiles(ctx.db, "Plan");
    const plan = await ctx.caller.settings.scenarios.create({
      name: "Move",
      ...ids,
    });
    await ctx.caller.settings.scenarios.activate({ id: plan!.id });

    expect(setting(ctx.db, SK_ACTIVE_SALARY_PROFILE_ID)).toBe(
      ids.salaryProfileId,
    );
    expect(setting(ctx.db, SK_ACTIVE_CONTRIB_PROFILE_ID)).toBe(
      ids.contributionProfileId,
    );
    expect(setting(ctx.db, SK_ACTIVE_RETIREMENT_PROFILE_ID)).toBe(
      ids.retirementProfileId,
    );
    expect(setting(ctx.db, SK_LAST_APPLIED_PLAN_ID)).toBe(plan!.id);
    const activeBudgets = ctx.db
      .select()
      .from(schema.budgetProfiles)
      .where(eq(schema.budgetProfiles.isActive, true))
      .all();
    expect(activeBudgets.map((b) => b.id)).toEqual([ids.budgetProfileId]);
  });

  it("an older Plan with an empty kind leaves that kind's active profile alone", async () => {
    const current = await seedProfiles(ctx.db, "Current", true);
    const ids = await seedProfiles(ctx.db, "Plan");
    const [plan] = ctx.db
      .insert(schema.scenarios)
      .values({ name: "Old", salaryProfileId: ids.salaryProfileId })
      .returning()
      .all();
    await ctx.caller.settings.scenarios.activate({ id: plan!.id });
    expect(setting(ctx.db, SK_ACTIVE_SALARY_PROFILE_ID)).toBe(
      ids.salaryProfileId,
    );
    const activeBudget = ctx.db
      .select()
      .from(schema.budgetProfiles)
      .where(eq(schema.budgetProfiles.isActive, true))
      .get();
    expect(activeBudget?.id).toBe(current.budgetProfileId);
  });

  it("refuses to apply without permission for every kind it changes, writing nothing", async () => {
    const current = await seedProfiles(ctx.db, "Current", true);
    const ids = await seedProfiles(ctx.db, "Plan");
    const plan = await ctx.caller.settings.scenarios.create({
      name: "Move",
      ...ids,
    });
    // Budget and contribution/salary permission, but retirement needs admin.
    const viewer = createViewerSessionWithPermissions([
      "scenario",
      "budget",
      "contributionProfile",
    ]).user;
    await expect(applyPlan(ctx.db as never, viewer, plan!.id)).rejects.toThrow(
      /retirement/,
    );
    expect(setting(ctx.db, SK_ACTIVE_SALARY_PROFILE_ID)).not.toBe(
      ids.salaryProfileId,
    );
    const activeBudget = ctx.db
      .select()
      .from(schema.budgetProfiles)
      .where(eq(schema.budgetProfiles.isActive, true))
      .get();
    expect(activeBudget?.id).toBe(current.budgetProfileId);
  });

  it("only kinds that change need permission — a non-admin can apply a Plan that keeps the active Retirement profile", async () => {
    const current = await seedProfiles(ctx.db, "Current", true);
    const ids = await seedProfiles(ctx.db, "Plan");
    // Make the current retirement profile the active one, and the Plan use it.
    ctx.db
      .insert(schema.appSettings)
      .values({
        key: SK_ACTIVE_RETIREMENT_PROFILE_ID,
        value: current.retirementProfileId,
      })
      .run();
    const plan = await ctx.caller.settings.scenarios.create({
      name: "Same retirement",
      ...ids,
      retirementProfileId: current.retirementProfileId,
    });
    const viewer = createViewerSessionWithPermissions([
      "budget",
      "contributionProfile",
    ]).user;
    await applyPlan(ctx.db as never, viewer, plan!.id);
    expect(setting(ctx.db, SK_ACTIVE_SALARY_PROFILE_ID)).toBe(
      ids.salaryProfileId,
    );
    expect(setting(ctx.db, SK_ACTIVE_RETIREMENT_PROFILE_ID)).toBe(
      current.retirementProfileId,
    );
  });

  it("refuses to delete a budget profile a Plan uses", async () => {
    await seedProfiles(ctx.db, "Current", true);
    const ids = await seedProfiles(ctx.db, "Plan");
    await ctx.caller.settings.scenarios.create({ name: "Keep", ...ids });
    await expect(
      ctx.caller.budget.deleteProfile({ id: ids.budgetProfileId }),
    ).rejects.toThrow(/used by Plan Keep/);
  });

  it("deleting a Plan leaves its profiles", async () => {
    const ids = await seedProfiles(ctx.db, "A");
    const plan = await ctx.caller.settings.scenarios.create({
      name: "Gone",
      ...ids,
    });
    await ctx.caller.settings.scenarios.delete({ id: plan!.id });
    expect(await ctx.caller.settings.scenarios.list()).toEqual([]);
    const salary = ctx.db
      .select()
      .from(schema.salaryProfiles)
      .where(eq(schema.salaryProfiles.id, ids.salaryProfileId))
      .get();
    expect(salary).toBeDefined();
  });
});
