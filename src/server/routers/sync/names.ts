/** Sync names router for renaming budget item subcategories to match API category names or vice versa. */

import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, syncProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { cacheGet } from "@/lib/budget-api";
import type { BudgetApiService, BudgetCategoryGroup } from "@/lib/budget-api";
import {
  loadBudgetItemLinks,
  setBudgetItemLink,
  loadSavingsGoalLinks,
  setSavingsGoalLink,
} from "@/server/helpers";
import { serviceEnum } from "./_shared";

export const syncNamesRouter = createTRPCRouter({
  /** Rename a budget item's subcategory to match the API category name. */
  renameBudgetItemToApi: syncProcedure
    .input(z.object({ budgetItemId: z.number().int(), service: serviceEnum }))
    .mutation(async ({ ctx, input }) => {
      const links = await loadBudgetItemLinks(
        ctx.db,
        [input.budgetItemId],
        input.service as BudgetApiService,
      );
      const link = links.get(input.budgetItemId);
      if (!link?.categoryName) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Item not linked to API category",
        });
      }
      await ctx.db
        .update(schema.budgetItems)
        .set({ subcategory: link.categoryName })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true, newName: link.categoryName };
    }),

  /** Rename a budget item's API category name to match the Ledgr subcategory (update stored name). */
  renameBudgetItemApiName: syncProcedure
    .input(z.object({ budgetItemId: z.number().int(), service: serviceEnum }))
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
      const links = await loadBudgetItemLinks(
        ctx.db,
        [input.budgetItemId],
        input.service as BudgetApiService,
      );
      const link = links.get(input.budgetItemId);
      if (!link) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Item not linked to API category",
        });
      }
      await setBudgetItemLink(ctx.db, {
        budgetItemId: input.budgetItemId,
        service: input.service as BudgetApiService,
        categoryId: link.categoryId,
        categoryName: item.subcategory,
        syncDirection: link.syncDirection,
        lastSyncedAt: link.lastSyncedAt,
      });
      return { ok: true, newApiName: item.subcategory };
    }),

  /** Move a budget item to the API's category group. */
  moveBudgetItemToApiGroup: syncProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        apiGroupName: z.string().min(1),
        service: serviceEnum,
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
  renameSavingsGoalToApi: syncProcedure
    .input(z.object({ goalId: z.number().int(), service: serviceEnum }))
    .mutation(async ({ ctx, input }) => {
      const links = await loadSavingsGoalLinks(
        ctx.db,
        [input.goalId],
        input.service as BudgetApiService,
        "primary",
      );
      const link = links.get(input.goalId);
      if (!link?.categoryName) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Goal not linked to API category",
        });
      }
      await ctx.db
        .update(schema.savingsGoals)
        .set({ name: link.categoryName })
        .where(eq(schema.savingsGoals.id, input.goalId));
      return { ok: true, newName: link.categoryName };
    }),

  /** Update a savings goal's stored API name to match its current Ledgr name. */
  renameSavingsGoalApiName: syncProcedure
    .input(z.object({ goalId: z.number().int(), service: serviceEnum }))
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
      const links = await loadSavingsGoalLinks(
        ctx.db,
        [input.goalId],
        input.service as BudgetApiService,
        "primary",
      );
      const link = links.get(input.goalId);
      if (!link) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Goal not linked to API category",
        });
      }
      await setSavingsGoalLink(ctx.db, {
        savingsGoalId: input.goalId,
        service: input.service as BudgetApiService,
        role: "primary",
        categoryId: link.categoryId,
        categoryName: goal.name,
        lastSyncedAt: link.lastSyncedAt,
      });
      return { ok: true, newApiName: goal.name };
    }),

  /** Batch rename all drifted items in one direction. */
  syncAllNames: syncProcedure
    .input(
      z.object({
        service: serviceEnum,
        direction: z.enum(["pull", "keepLedgr"]),
        includeCategories: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let budgetRenamed = 0;
      let savingsRenamed = 0;
      let categoriesMoved = 0;

      const service = input.service as BudgetApiService;

      // Budget items with a link for this service
      const allBudgetItemRows = await ctx.db
        .select({
          id: schema.budgetItems.id,
          category: schema.budgetItems.category,
          subcategory: schema.budgetItems.subcategory,
        })
        .from(schema.budgetItems);
      const budgetItemLinks = await loadBudgetItemLinks(
        ctx.db,
        allBudgetItemRows.map((i) => i.id),
        service,
      );
      const allBudgetItems = allBudgetItemRows
        .map((i) => {
          const link = budgetItemLinks.get(i.id);
          return {
            ...i,
            apiCategoryId: link?.categoryId ?? null,
            apiCategoryName: link?.categoryName ?? null,
          };
        })
        .filter((i) => i.apiCategoryId);

      // Look up API category groups from cache for name + group resolution
      const apiCategoryMap = new Map<
        string,
        { name: string; groupName: string }
      >();
      if (input.direction === "pull") {
        {
          const cached = await cacheGet<BudgetCategoryGroup[]>(
            ctx.db,
            service,
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
        const updates: { subcategory?: string; category?: string } = {};
        let newApiCategoryName: string | null = null;

        // For pull: use the current API name from cache (if available), not stored name
        const currentApiName =
          (item.apiCategoryId
            ? apiCategoryMap.get(item.apiCategoryId)?.name
            : null) ?? item.apiCategoryName;

        // Name drift
        if (currentApiName && item.subcategory !== currentApiName) {
          if (input.direction === "pull") {
            updates.subcategory = currentApiName;
            newApiCategoryName = currentApiName;
          } else {
            newApiCategoryName = item.subcategory;
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
        if (newApiCategoryName !== null && item.apiCategoryId) {
          await setBudgetItemLink(ctx.db, {
            budgetItemId: item.id,
            service,
            categoryId: item.apiCategoryId,
            categoryName: newApiCategoryName,
          });
        }
      }

      // Savings goals with a primary link for this service
      const allGoalRows = await ctx.db
        .select({ id: schema.savingsGoals.id, name: schema.savingsGoals.name })
        .from(schema.savingsGoals);
      const goalLinks = await loadSavingsGoalLinks(
        ctx.db,
        allGoalRows.map((g) => g.id),
        service,
        "primary",
      );
      const goals = allGoalRows
        .map((g) => {
          const link = goalLinks.get(g.id);
          return {
            ...g,
            apiCategoryId: link?.categoryId ?? null,
            apiCategoryName: link?.categoryName ?? null,
          };
        })
        .filter((g) => g.apiCategoryId);

      for (const goal of goals) {
        const currentGoalApiName =
          (goal.apiCategoryId
            ? apiCategoryMap.get(goal.apiCategoryId)?.name
            : null) ?? goal.apiCategoryName;
        if (!currentGoalApiName || goal.name === currentGoalApiName) continue;
        if (input.direction === "pull") {
          await ctx.db
            .update(schema.savingsGoals)
            .set({ name: currentGoalApiName })
            .where(eq(schema.savingsGoals.id, goal.id));
          await setSavingsGoalLink(ctx.db, {
            savingsGoalId: goal.id,
            service,
            role: "primary",
            categoryId: goal.apiCategoryId!,
            categoryName: currentGoalApiName,
          });
        } else {
          await setSavingsGoalLink(ctx.db, {
            savingsGoalId: goal.id,
            service,
            role: "primary",
            categoryId: goal.apiCategoryId!,
            categoryName: goal.name,
          });
        }
        savingsRenamed++;
      }

      return { ok: true, budgetRenamed, savingsRenamed, categoriesMoved };
    }),
});
