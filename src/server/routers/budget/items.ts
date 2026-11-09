import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { budgetProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { requireBudgetProfile } from "@/server/services/budget/budget-client";
import type { DbOrTx } from "@/lib/db";
import { firstRow } from "@/lib/utils/first-row";

type BudgetItemRow = typeof schema.budgetItems.$inferSelect;

/**
 * Group a profile's budget items (already sort_order-ordered) into ordered
 * category blocks, preserving both the categories' relative order and each
 * category's internal item order. Mirrors the client-side grouping in
 * useBudgetDerivedData's categoryMap (use-budget-derived-data.ts) — same
 * logic, server-side, used by the reorder mutations below.
 */
function groupItemsByCategory(
  items: BudgetItemRow[],
): { category: string; items: BudgetItemRow[] }[] {
  const map = new Map<string, BudgetItemRow[]>();
  for (const item of items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return Array.from(map.entries()).map(([category, categoryItems]) => ({
    category,
    items: categoryItems,
  }));
}

/**
 * Flatten ordered category blocks back into a single item list and write a
 * clean, gapless 0..N-1 sort_order sequence. Used after every reorder so
 * any pre-existing sort_order gaps/duplicates get cleaned up as a side
 * effect (self-healing) instead of accumulating drift over time.
 */
async function renumberItems(
  db: DbOrTx,
  blocks: { category: string; items: BudgetItemRow[] }[],
): Promise<void> {
  let sortOrder = 0;
  for (const block of blocks) {
    for (const item of block.items) {
      await db
        .update(schema.budgetItems)
        .set({ sortOrder })
        .where(eq(schema.budgetItems.id, item.id));
      sortOrder++;
    }
  }
}

export const itemProcedures = {
  /** Create a new budget item. */
  createItem: budgetProcedure
    .input(
      z.object({
        category: z.string().trim().min(1),
        subcategory: z.string().trim().min(1),
        isEssential: z.boolean().default(true),
        profileId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await requireBudgetProfile(ctx.db, input.profileId);

      const numCols = profile.columnLabels.length;
      const amounts = new Array(numCols).fill(0) as number[];

      // Determine sort order: place at end of category
      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      const sameCatItems = items.filter((i) => i.category === input.category);
      const maxSort =
        sameCatItems.length > 0
          ? Math.max(...sameCatItems.map((i) => i.sortOrder))
          : items.length > 0
            ? Math.max(...items.map((i) => i.sortOrder))
            : 0;

      return ctx.db
        .insert(schema.budgetItems)
        .values({
          profileId: profile.id,
          category: input.category,
          subcategory: input.subcategory,
          amounts,
          isEssential: input.isEssential,
          sortOrder: maxSort + 1,
        })
        .returning()
        .then(firstRow);
    }),

  /** Delete a budget item. */
  deleteItem: budgetProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.id));
      return { ok: true };
    }),

  /** Move a budget item to a different category. */
  moveItem: budgetProcedure
    .input(
      z.object({
        id: z.number().int(),
        newCategory: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db
        .update(schema.budgetItems)
        .set({ category: input.newCategory })
        .where(eq(schema.budgetItems.id, input.id))
        .returning()
        .then(firstRow);
    }),

  /** Swap a category's whole block of items with an adjacent category's
   *  block. No-ops at the first/last category boundary. */
  reorderCategory: budgetProcedure
    .input(
      z.object({
        profileId: z.number().optional(),
        category: z.string(),
        direction: z.enum(["up", "down"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await requireBudgetProfile(ctx.db, input.profileId);

      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id))
        .orderBy(asc(schema.budgetItems.sortOrder));

      const blocks = groupItemsByCategory(items);
      const index = blocks.findIndex((b) => b.category === input.category);
      if (index === -1) return { ok: true };

      const swapWith = input.direction === "up" ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= blocks.length) return { ok: true };

      [blocks[index], blocks[swapWith]] = [blocks[swapWith]!, blocks[index]!];
      await ctx.db.transaction((tx) => renumberItems(tx, blocks));
      return { ok: true };
    }),

  /** Swap an item's position with an adjacent item within the same
   *  category. No-ops at the category's first/last item boundary — moving
   *  an item into a different category is the "Move..." dropdown's job
   *  (moveItem above), not this. */
  reorderItem: budgetProcedure
    .input(
      z.object({
        id: z.number().int(),
        direction: z.enum(["up", "down"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.id));
      if (!target)
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });

      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, target.profileId))
        .orderBy(asc(schema.budgetItems.sortOrder));

      const blocks = groupItemsByCategory(items);
      const block = blocks.find((b) => b.category === target.category);
      if (!block) return { ok: true };

      const index = block.items.findIndex((i) => i.id === target.id);
      if (index === -1) return { ok: true };

      const swapWith = input.direction === "up" ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= block.items.length) return { ok: true };

      [block.items[index], block.items[swapWith]] = [
        block.items[swapWith]!,
        block.items[index]!,
      ];
      await ctx.db.transaction((tx) => renumberItems(tx, blocks));
      return { ok: true };
    }),

  /** Update a budget item's essential flag. */
  updateItemEssential: budgetProcedure
    .input(
      z.object({
        id: z.number().int(),
        isEssential: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db
        .update(schema.budgetItems)
        .set({ isEssential: input.isEssential })
        .where(eq(schema.budgetItems.id, input.id))
        .returning()
        .then(firstRow);
    }),

  /** Toggle isEssential for all items in a category. */
  updateCategoryEssential: budgetProcedure
    .input(
      z.object({
        category: z.string().trim().min(1),
        isEssential: z.boolean(),
        profileId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await requireBudgetProfile(ctx.db, input.profileId);

      const allItems = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));

      for (const item of allItems.filter(
        (i) => i.category === input.category,
      )) {
        await ctx.db
          .update(schema.budgetItems)
          .set({ isEssential: input.isEssential })
          .where(eq(schema.budgetItems.id, item.id));
      }
      return { ok: true };
    }),
};
