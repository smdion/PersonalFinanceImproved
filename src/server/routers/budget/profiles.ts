import { assertNoPlanUses } from "@/server/services/profiles/plans";
import { SK_RETIREMENT_DECUMULATION_BUDGET_PROFILE_ID } from "@/lib/constants/settings-keys";
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { budgetProcedure } from "../../trpc";
import {
  zItemAmountActiveFields,
  toItemAmountActiveMap,
} from "@/lib/pure/household/what-if.schema";
import * as schema from "@/lib/db/schema";
import { canDeleteBudgetProfile } from "@/lib/pure/household/profiles";
import { columnLabelsSchema } from "@/lib/db/json-schemas";
import { firstRow } from "@/lib/utils/first-row";

export const profileProcedures = {
  /** Create a new budget profile, pre-populated with standard template
   *  categories. Its take-home math uses the active Contribution and Salary
   *  profiles, like every budget profile. */
  createProfile: budgetProcedure
    .input(
      z.object({
        name: z.string().trim().min(1),
        columnLabels: columnLabelsSchema.default(["Standard"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // One transaction: a failed template or allocation insert must not
      // leave an empty profile behind.
      return ctx.db.transaction(async (tx) => {
        const rows = await tx
          .insert(schema.budgetProfiles)
          .values({
            name: input.name,
            columnLabels: input.columnLabels,
            isActive: false,
          })
          .returning();
        const profile = rows[0]!;

        // Pre-populate with template categories (all amounts zeroed)
        const { BUDGET_TEMPLATE } =
          await import("@/lib/config/budget-template");
        const numCols = input.columnLabels.length;
        const zeroAmounts = new Array(numCols).fill(0) as number[];
        await tx.insert(schema.budgetItems).values(
          BUDGET_TEMPLATE.map((t, i) => ({
            profileId: profile.id,
            category: t.category,
            subcategory: t.subcategory,
            amounts: zeroAmounts,
            isEssential: t.isEssential,
            sortOrder: i,
          })),
        );

        // Savings funding is per-profile with no shared default — every
        // existing active goal needs an explicit $0/no-percent row under this
        // new profile (see savings_goal_profile_allocations' table comment).
        const goals = await tx
          .select({ id: schema.savingsGoals.id })
          .from(schema.savingsGoals)
          .where(eq(schema.savingsGoals.isActive, true));
        if (goals.length > 0) {
          await tx.insert(schema.savingsGoalProfileAllocations).values(
            goals.map((g) => ({
              goalId: g.id,
              budgetProfileId: profile.id,
              allocationPercent: null,
              monthlyContribution: "0",
            })),
          );
        }

        return profile;
      });
    }),

  /**
   * Clone a profile's columns, items and savings allocations under a new name, inactive.
   * No API-link fields or `contributionAccountId` are copied: two profiles pushing to one
   * YNAB category or contribution account is an external-write hazard. `budget` permission.
   */
  duplicateProfile: budgetProcedure
    .input(
      z.object({
        sourceProfileId: z.number().int(),
        name: z.string().trim().min(1),
        /** The What-If tab's edited item amounts, keyed by SOURCE item id; applied in
         *  the clone's transaction so a failure can't leave a half-edited copy. */
        itemAmountActiveFields: zItemAmountActiveFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const itemActiveMap = toItemAmountActiveMap(input.itemAmountActiveFields);
      return ctx.db.transaction(async (tx) => {
        const source = await tx
          .select()
          .from(schema.budgetProfiles)
          .where(eq(schema.budgetProfiles.id, input.sourceProfileId))
          .then(firstRow);
        if (!source)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Source profile not found",
          });

        const created = await tx
          .insert(schema.budgetProfiles)
          .values({
            name: input.name,
            description: source.description,
            columnLabels: source.columnLabels,
            columnMonths: source.columnMonths,
            isActive: false,
          })
          .returning()
          .then((r) => r[0]!);

        const items = await tx
          .select()
          .from(schema.budgetItems)
          .where(eq(schema.budgetItems.profileId, input.sourceProfileId))
          .orderBy(asc(schema.budgetItems.sortOrder));
        if (items.length > 0) {
          await tx.insert(schema.budgetItems).values(
            items.map((i) => {
              const rawAmounts = i.amounts as number[];
              const amounts =
                itemActiveMap.size === 0
                  ? rawAmounts
                  : rawAmounts.map(
                      (amount, col) =>
                        itemActiveMap.get(`${i.id}:${col}`) ?? amount,
                    );
              return {
                profileId: created.id,
                category: i.category,
                subcategory: i.subcategory,
                amounts,
                mortgageLoanId: i.mortgageLoanId,
                isEssential: i.isEssential,
                sortOrder: i.sortOrder,
                // API links and contribution links deliberately left unset.
              };
            }),
          );
        }

        // Savings funding is per-(goal, profile) with no shared default, so
        // the clone needs its own explicit row for every goal the source
        // funds.
        const allocations = await tx
          .select()
          .from(schema.savingsGoalProfileAllocations)
          .where(
            eq(
              schema.savingsGoalProfileAllocations.budgetProfileId,
              input.sourceProfileId,
            ),
          );
        if (allocations.length > 0) {
          await tx.insert(schema.savingsGoalProfileAllocations).values(
            allocations.map((a) => ({
              goalId: a.goalId,
              budgetProfileId: created.id,
              allocationPercent: a.allocationPercent,
              monthlyContribution: a.monthlyContribution,
            })),
          );
        }

        return created;
      });
    }),

  /** Rename a budget profile. */
  renameProfile: budgetProcedure
    .input(z.object({ id: z.number().int(), name: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.budgetProfiles)
        .set({ name: input.name })
        .where(eq(schema.budgetProfiles.id, input.id));
      return { ok: true };
    }),

  /** Delete a budget profile (cannot delete the active one). */
  deleteProfile: budgetProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const profiles = await ctx.db
        .select()
        .from(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.id, input.id));
      const profile = profiles[0];
      if (!profile)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Profile not found",
        });
      const deleteCheck = canDeleteBudgetProfile(profile);
      if (!deleteCheck.allowed)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: deleteCheck.reason,
        });

      await assertNoPlanUses(ctx.db, "budget", input.id);

      // Delete associated items first
      await ctx.db
        .delete(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, input.id));
      await ctx.db
        .delete(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.id, input.id));

      // Nothing may keep pointing at the deleted profile: the retirement
      // page's retirement-spending pick (app_settings holds the id as a
      // number or numeric string) and a budget-API link.
      const [decumulationSetting] = await ctx.db
        .select()
        .from(schema.appSettings)
        .where(
          eq(
            schema.appSettings.key,
            SK_RETIREMENT_DECUMULATION_BUDGET_PROFILE_ID,
          ),
        );
      if (
        decumulationSetting &&
        Number(decumulationSetting.value) === input.id
      ) {
        await ctx.db
          .delete(schema.appSettings)
          .where(
            eq(
              schema.appSettings.key,
              SK_RETIREMENT_DECUMULATION_BUDGET_PROFILE_ID,
            ),
          );
      }
      await ctx.db
        .update(schema.apiConnections)
        .set({ linkedProfileId: null })
        .where(eq(schema.apiConnections.linkedProfileId, input.id));
      return { ok: true };
    }),

  /** Make a profile the only active one, in one transaction: zero active profiles
   *  would read as "no profile" to every getActiveBudgetProfile caller. */
  setActiveProfile: budgetProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        await tx.update(schema.budgetProfiles).set({ isActive: false });
        const activated = await tx
          .update(schema.budgetProfiles)
          .set({ isActive: true })
          .where(eq(schema.budgetProfiles.id, input.id))
          .returning({ id: schema.budgetProfiles.id });
        // A stale or wrong id would otherwise commit zero active profiles.
        if (activated.length === 0)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That budget profile no longer exists",
          });
      });
      return { ok: true };
    }),
};
