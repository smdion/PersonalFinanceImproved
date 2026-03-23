/** Sync names router for renaming budget item subcategories to match API category names or vice versa. */

import { z } from "zod/v4";
import { eq, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { getActiveBudgetApi, cacheGet } from "@/lib/budget-api";
import type {
  BudgetApiService,
  BudgetCategoryGroup,
} from "@/lib/budget-api";

const serviceEnum = z.enum(["ynab", "actual"]);

export const syncNamesRouter = createTRPCRouter({
  /** Rename a budget item's subcategory to match the API category name. */
  renameBudgetItemToApi: adminProcedure
    .input(z.object({ budgetItemId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .select({ apiCategoryName: schema.budgetItems.apiCategoryName })
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      if (!item?.apiCategoryName) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Item not linked to API category",
        });
      }
      await ctx.db
        .update(schema.budgetItems)
        .set({ subcategory: item.apiCategoryName })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true, newName: item.apiCategoryName };
    }),

  /** Rename a budget item's API category name to match the Ledgr subcategory (update stored name). */
  renameBudgetItemApiName: adminProcedure
    .input(z.object({ budgetItemId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .select({ subcategory: schema.budgetItems.subcategory })
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Budget item not found",
        });
      }
      await ctx.db
        .update(schema.budgetItems)
        .set({ apiCategoryName: item.subcategory })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true, newApiName: item.subcategory };
    }),

  /** Move a budget item to the API's category group. */
  moveBudgetItemToApiGroup: adminProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        apiGroupName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.budgetItems)
        .set({ category: input.apiGroupName })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true };
    }),

  /** Rename a savings goal to match the API category name. */
  renameSavingsGoalToApi: adminProcedure
    .input(z.object({ goalId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [goal] = await ctx.db
        .select({ apiCategoryName: schema.savingsGoals.apiCategoryName })
        .from(schema.savingsGoals)
        .where(eq(schema.savingsGoals.id, input.goalId));
      if (!goal?.apiCategoryName) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Goal not linked to API category",
        });
      }
      await ctx.db
        .update(schema.savingsGoals)
        .set({ name: goal.apiCategoryName })
        .where(eq(schema.savingsGoals.id, input.goalId));
      return { ok: true, newName: goal.apiCategoryName };
    }),

  /** Update a savings goal's stored API name to match its current Ledgr name. */
  renameSavingsGoalApiName: adminProcedure
    .input(z.object({ goalId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [goal] = await ctx.db
        .select({ name: schema.savingsGoals.name })
        .from(schema.savingsGoals)
        .where(eq(schema.savingsGoals.id, input.goalId));
      if (!goal) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Savings goal not found",
        });
      }
      await ctx.db
        .update(schema.savingsGoals)
        .set({ apiCategoryName: goal.name })
        .where(eq(schema.savingsGoals.id, input.goalId));
      return { ok: true, newApiName: goal.name };
    }),

  /** Batch rename all drifted items in one direction. */
  syncAllNames: adminProcedure
    .input(
      z.object({
        service: serviceEnum.optional(),
        direction: z.enum(["pull", "keepLedgr"]),
        includeCategories: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let budgetRenamed = 0;
      let savingsRenamed = 0;
      let categoriesMoved = 0;

      // Budget items with drift (name or category group)
      const allBudgetItems = await ctx.db
        .select({
          id: schema.budgetItems.id,
          category: schema.budgetItems.category,
          subcategory: schema.budgetItems.subcategory,
          apiCategoryId: schema.budgetItems.apiCategoryId,
          apiCategoryName: schema.budgetItems.apiCategoryName,
        })
        .from(schema.budgetItems)
        .where(isNotNull(schema.budgetItems.apiCategoryId));

      // Look up API category groups from cache for name + group resolution
      const apiCategoryMap = new Map<
        string,
        { name: string; groupName: string }
      >();
      if (input.direction === "pull") {
        // Use provided service or fall back to active API
        const cacheService =
          input.service ?? (await getActiveBudgetApi(ctx.db));
        if (cacheService !== "none") {
          const cached = await cacheGet<BudgetCategoryGroup[]>(
            ctx.db,
            cacheService as BudgetApiService,
            "categories",
          );
          if (cached) {
            for (const group of cached.data) {
              for (const cat of group.categories) {
                apiCategoryMap.set(cat.id, {
                  name: cat.name,
                  groupName: group.name,
                });
              }
            }
          }
        }
      }

      for (const item of allBudgetItems) {
        const updates: Record<string, string> = {};

        // For pull: use the current API name from cache (if available), not stored name
        const currentApiName =
          (item.apiCategoryId
            ? apiCategoryMap.get(item.apiCategoryId)?.name
            : null) ?? item.apiCategoryName;

        // Name drift
        if (currentApiName && item.subcategory !== currentApiName) {
          if (input.direction === "pull") {
            updates.subcategory = currentApiName;
            updates.apiCategoryName = currentApiName;
          } else {
            updates.apiCategoryName = item.subcategory;
          }
          budgetRenamed++;
        }

        // Category group drift (pull only)
        if (
          input.direction === "pull" &&
          input.includeCategories &&
          item.apiCategoryId
        ) {
          const apiCat = apiCategoryMap.get(item.apiCategoryId);
          if (apiCat && apiCat.groupName !== item.category) {
            updates.category = apiCat.groupName;
            categoriesMoved++;
          }
        }

        if (Object.keys(updates).length > 0) {
          await ctx.db
            .update(schema.budgetItems)
            .set(updates)
            .where(eq(schema.budgetItems.id, item.id));
        }
      }

      // Savings goals with drift
      const goals = await ctx.db
        .select({
          id: schema.savingsGoals.id,
          name: schema.savingsGoals.name,
          apiCategoryId: schema.savingsGoals.apiCategoryId,
          apiCategoryName: schema.savingsGoals.apiCategoryName,
        })
        .from(schema.savingsGoals)
        .where(isNotNull(schema.savingsGoals.apiCategoryId));

      for (const goal of goals) {
        const currentGoalApiName =
          (goal.apiCategoryId
            ? apiCategoryMap.get(goal.apiCategoryId)?.name
            : null) ?? goal.apiCategoryName;
        if (!currentGoalApiName || goal.name === currentGoalApiName) continue;
        if (input.direction === "pull") {
          await ctx.db
            .update(schema.savingsGoals)
            .set({
              name: currentGoalApiName,
              apiCategoryName: currentGoalApiName,
            })
            .where(eq(schema.savingsGoals.id, goal.id));
        } else {
          await ctx.db
            .update(schema.savingsGoals)
            .set({ apiCategoryName: goal.name })
            .where(eq(schema.savingsGoals.id, goal.id));
        }
        savingsRenamed++;
      }

      return { ok: true, budgetRenamed, savingsRenamed, categoriesMoved };
    }),
});
