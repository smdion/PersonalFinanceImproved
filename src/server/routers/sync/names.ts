/** Sync names router for renaming budget item subcategories to match API category names or vice versa. */

import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminProcedure, createTRPCRouter } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  loadBudgetItemLinks,
  setBudgetItemLink,
  loadSavingsGoalLinks,
  setSavingsGoalLink,
} from "@/server/data/category-links";
import { serviceEnum } from "./_shared";
import { syncAllNames } from "@/server/services/sync/sync-names";

export const syncNamesRouter = createTRPCRouter({
  /** Rename a budget item's subcategory to match the API category name. */
  renameBudgetItemToApi: adminProcedure
    .input(z.object({ budgetItemId: z.number().int(), service: serviceEnum }))
    .mutation(async ({ ctx, input }) => {
      const links = await loadBudgetItemLinks(
        ctx.db,
        [input.budgetItemId],
        input.service,
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
  renameBudgetItemApiName: adminProcedure
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
        input.service,
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
        service: input.service,
        categoryId: link.categoryId,
        categoryName: item.subcategory,
        syncDirection: link.syncDirection,
        lastSyncedAt: link.lastSyncedAt,
      });
      return { ok: true, newApiName: item.subcategory };
    }),

  /** Move a budget item to the API's category group. */
  moveBudgetItemToApiGroup: adminProcedure
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
  renameSavingsGoalToApi: adminProcedure
    .input(z.object({ goalId: z.number().int(), service: serviceEnum }))
    .mutation(async ({ ctx, input }) => {
      const links = await loadSavingsGoalLinks(
        ctx.db,
        [input.goalId],
        input.service,
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
  renameSavingsGoalApiName: adminProcedure
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
        input.service,
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
        service: input.service,
        role: "primary",
        categoryId: link.categoryId,
        categoryName: goal.name,
        lastSyncedAt: link.lastSyncedAt,
      });
      return { ok: true, newApiName: goal.name };
    }),

  /** Batch rename all drifted items in one direction. */
  syncAllNames: adminProcedure
    .input(
      z.object({
        service: serviceEnum,
        direction: z.enum(["pull", "keepLedgr"]),
        includeCategories: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) => syncAllNames(ctx, input)),
});
