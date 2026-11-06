import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  savingsProcedure,
  type Context,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { getResolvedGoalAllocations } from "@/server/services/savings/savings-allocation";
import {
  setBudgetItemLink,
  loadSavingsGoalLinks,
  copySavingsGoalLinks,
} from "@/server/data/category-links";
import { resolveTargetBudgetProfile } from "@/server/data/budget-profiles";
import { zCalendarDate, zDecimal } from "@/lib/utils/zod-fields";
import {
  targetModeSchema,
  budgetApiServiceSchema,
} from "@/lib/config/enum-values.schema";
import { BUDGET_API_SERVICE_VALUES } from "@/lib/config/budget-apps";
import { getActiveBudgetApi } from "@/lib/budget-api";
import { firstRow } from "@/lib/utils/first-row";

/**
 * Delete a savings goal, detaching its sub-goals first (they become
 * top-level). The database can't be relied on for this: installs since
 * v0.8.0 have no foreign key on parent_goal_id (SQLite can't add one in
 * place), and an orphaned sub-goal disappears from the Savings page.
 */
async function deleteSavingsGoal(db: Context["db"], id: number) {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.savingsGoals)
      .set({ parentGoalId: null })
      .where(eq(schema.savingsGoals.parentGoalId, id));
    await tx.delete(schema.savingsGoals).where(eq(schema.savingsGoals.id, id));
  });
}

const savingsGoalInput = z.object({
  name: z.string().min(1),
  parentGoalId: z.number().int().nullable().optional(),
  targetAmount: zDecimal.nullable().optional(),
  targetMonths: z.number().int().nullable().optional(),
  targetDate: zCalendarDate.nullable().optional(),
  priority: z.number().int().default(0),
  isActive: z.boolean().default(true),
  isEmergencyFund: z.boolean().default(false),
  targetMode: targetModeSchema.default("fixed"),
});

export const goalProcedures = {
  // ══ CONVERSION: BUDGET ITEM ↔ SAVINGS GOAL ══

  /** Convert a budget item into a savings goal, transferring the API category link. */
  convertBudgetItemToGoal: savingsProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        goalName: z.string().min(1),
        monthlyContribution: zDecimal.default("0"),
        targetAmount: zDecimal.nullable().optional(),
        targetMode: targetModeSchema.default("ongoing"),
        // Which service's link (if any) to carry over to the new goal.
        // Omitted: defensible default for a conversion action — copy the
        // link for whichever service is currently active, if the item has
        // one. Writes always require an explicit service when the caller
        // knows it; this is not a silent fallback for a plain link-mutation.
        service: budgetApiServiceSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch the budget item
      const [item] = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      if (!item)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Budget item not found",
        });

      return ctx.db.transaction(async (tx) => {
        // Create the savings goal WITHOUT the raw (dead) API-linking columns —
        // the link, if any, is copied below via copySavingsGoalLinks.
        const [goal] = await tx
          .insert(schema.savingsGoals)
          .values({
            name: input.goalName,
            targetAmount: input.targetAmount ?? null,
            targetMode: input.targetMode,
          })
          .returning();

        if (goal) {
          // A budget item can carry a link for EACH service at once
          // (budget_item_category_links is keyed per (item, service) —
          // that's the whole point of the join-table migration). An
          // explicit `input.service` copies just that one (the caller knows
          // which they mean); omitted copies every service the item is
          // actually linked to, not just whichever one happens to be
          // "active" — otherwise a household with both YNAB and Actual
          // connected silently loses the inactive service's link on every
          // conversion.
          const servicesToCopy = input.service
            ? [input.service]
            : BUDGET_API_SERVICE_VALUES;
          for (const service of servicesToCopy) {
            await copySavingsGoalLinks(tx, {
              fromBudgetItemId: item.id,
              toSavingsGoalId: goal.id,
              service,
            });
          }
        }

        // Funding is per-profile with no shared default — seed every existing
        // budget profile with the converted amount (closest match to the old
        // shared-default behavior; the user can customize per-profile after).
        const profiles = await tx
          .select({ id: schema.budgetProfiles.id })
          .from(schema.budgetProfiles);
        if (goal && profiles.length > 0) {
          await tx.insert(schema.savingsGoalProfileAllocations).values(
            profiles.map((p) => ({
              goalId: goal.id,
              budgetProfileId: p.id,
              allocationPercent: null,
              monthlyContribution: input.monthlyContribution,
            })),
          );
        }

        // Delete the budget item
        await tx
          .delete(schema.budgetItems)
          .where(eq(schema.budgetItems.id, input.budgetItemId));

        return goal;
      });
    }),

  /** Convert a savings goal into a budget item, transferring the API category link. */
  convertGoalToBudgetItem: savingsProcedure
    .input(
      z.object({
        goalId: z.number().int(),
        category: z.string().min(1),
        subcategory: z.string().min(1),
        isEssential: z.boolean().default(false),
        profileId: z.number().optional(),
        // Which service's link (if any) to carry over to the new budget
        // item. Omitted: defensible default for a conversion action — copy
        // the link for whichever service is currently active, if the goal
        // has one.
        service: budgetApiServiceSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch the savings goal
      const [goal] = await ctx.db
        .select()
        .from(schema.savingsGoals)
        .where(eq(schema.savingsGoals.id, input.goalId));
      if (!goal)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Savings goal not found",
        });

      // Target profile: explicit input.profileId (a client editing a
      // Plan-pinned/viewed non-active profile) else the globally-active one.
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No active budget profile",
        });

      return ctx.db.transaction(async (tx) => {
        // The funding carries over: the item budgets what this profile was
        // putting into the goal each month, in every column.
        const funding = await getResolvedGoalAllocations(
          tx,
          [goal],
          profile.id,
        );
        const numCols = profile.columnLabels.length;
        const amounts = new Array(numCols).fill(
          funding.get(goal.id)?.monthlyContribution ?? 0,
        ) as number[];

        // Place at end of category
        const existingItems = await tx
          .select({
            sortOrder: schema.budgetItems.sortOrder,
            category: schema.budgetItems.category,
          })
          .from(schema.budgetItems)
          .where(eq(schema.budgetItems.profileId, profile.id));
        const sameCat = existingItems.filter(
          (i) => i.category === input.category,
        );
        const maxSort =
          sameCat.length > 0
            ? Math.max(...sameCat.map((i) => i.sortOrder))
            : existingItems.length > 0
              ? Math.max(...existingItems.map((i) => i.sortOrder))
              : 0;

        // Create budget item WITHOUT the raw (dead) API-linking columns — the
        // link, if any, is copied below.
        const [item] = await tx
          .insert(schema.budgetItems)
          .values({
            profileId: profile.id,
            category: input.category,
            subcategory: input.subcategory,
            amounts,
            isEssential: input.isEssential,
            sortOrder: maxSort + 1,
          })
          .returning();

        if (item) {
          // Same reasoning as convertBudgetItemToGoal above: a savings goal
          // can carry a primary link for each service at once. Explicit
          // input.service copies just that one; omitted copies every
          // service the goal is actually linked to.
          const servicesToCopy = input.service
            ? [input.service]
            : BUDGET_API_SERVICE_VALUES;
          for (const service of servicesToCopy) {
            const goalLinks = await loadSavingsGoalLinks(
              tx,
              [goal.id],
              service,
              "primary",
            );
            const goalLink = goalLinks.get(goal.id);
            if (goalLink) {
              await setBudgetItemLink(tx, {
                budgetItemId: item.id,
                service,
                categoryId: goalLink.categoryId,
                categoryName: goalLink.categoryName,
                syncDirection: "pull",
                lastSyncedAt: goalLink.lastSyncedAt,
              });
            }
          }
        }

        // Delete the savings goal (cascades to savings_monthly, planned
        // transactions, overrides; sub-goals become top-level)
        await deleteSavingsGoal(tx, input.goalId);

        return item;
      });
    }),

  savingsGoals: createTRPCRouter({
    // No live UI consumer reads this today (the Savings page uses
    // computeSummary's goalsForClient instead — see budget-content.tsx's
    // comment), but it's a general-purpose CRUD list endpoint, so its
    // apiCategoryId/apiCategoryName/isApiSyncEnabled must still reflect the
    // resolved link, not the dead raw columns, in case something starts
    // reading them.
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(schema.savingsGoals)
        .orderBy(asc(schema.savingsGoals.priority));
      const active = await getActiveBudgetApi(ctx.db);
      const links =
        active === "none"
          ? new Map()
          : await loadSavingsGoalLinks(
              ctx.db,
              rows.map((r) => r.id),
              active,
              "primary",
            );
      return rows.map((r) => {
        const link = links.get(r.id);
        return {
          ...r,
          apiCategoryId: link?.categoryId ?? null,
          apiCategoryName: link?.categoryName ?? null,
          isApiSyncEnabled: !!link,
        };
      });
    }),
    create: savingsProcedure
      .input(savingsGoalInput)
      .mutation(async ({ ctx, input }) => {
        const goal = await ctx.db
          .insert(schema.savingsGoals)
          .values(input)
          .returning()
          .then((r) => r[0]!);
        // Funding is per-profile with no shared default — every existing
        // budget profile needs an explicit $0/no-percent row for this new
        // goal (see savings_goal_profile_allocations' table comment).
        const profiles = await ctx.db
          .select({ id: schema.budgetProfiles.id })
          .from(schema.budgetProfiles);
        if (profiles.length > 0) {
          await ctx.db.insert(schema.savingsGoalProfileAllocations).values(
            profiles.map((p) => ({
              goalId: goal.id,
              budgetProfileId: p.id,
              allocationPercent: null,
              monthlyContribution: "0",
            })),
          );
        }
        return goal;
      }),
    update: savingsProcedure
      .input(z.object({ id: z.number().int() }).extend(savingsGoalInput.shape))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.savingsGoals)
          .set(data)
          .where(eq(schema.savingsGoals.id, id))
          .returning()
          .then(firstRow),
      ),
    delete: savingsProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) => deleteSavingsGoal(ctx.db, input.id)),
  }),
};
