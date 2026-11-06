import { z } from "zod/v4";
import { protectedProcedure } from "../../trpc";
import { log } from "@/lib/logger";
import {
  getClientForService,
  getActiveBudgetApi,
  cacheGet,
  type BudgetTransaction,
} from "@/lib/budget-api";
import { safeDivide } from "@/lib/utils/math";
import { zCalendarDate } from "@/lib/utils/zod-fields";

/** The cached category list as the comparison reads it. A list cached
 *  before groups carried `isIncome` has none: not income until the next
 *  sync, which also brings Actual's names. */
const cachedIncomeGroups = z.array(
  z.looseObject({
    isIncome: z.boolean().optional(),
    categories: z.array(z.looseObject({ id: z.string() })),
  }),
);

/** Ids of the cached categories in income groups. */
async function cachedIncomeCategoryIds(
  db: Parameters<typeof cacheGet>[0],
  service: Parameters<typeof cacheGet>[1],
): Promise<Set<string>> {
  const cached = await cacheGet<unknown>(db, service, "categories");
  if (!cached) return new Set();
  const groups = cachedIncomeGroups.safeParse(cached.data);
  if (!groups.success) {
    log("warn", "expense_comparison.categories_cache_unreadable", {
      service,
      error: groups.error.message.slice(0, 200),
    });
    return new Set();
  }
  return new Set(
    groups.data
      .filter((g) => g.isIncome)
      .flatMap((g) => g.categories.map((c) => c.id)),
  );
}

export const expenseComparisonProcedures = {
  /** Compare expenses between two periods using cached transaction data. */
  computeExpenseComparison: protectedProcedure
    .input(
      z.object({
        currentStart: zCalendarDate,
        currentEnd: zCalendarDate,
        priorStart: zCalendarDate,
        priorEnd: zCalendarDate,
      }),
    )
    .query(async ({ ctx, input }) => {
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none") return { categories: [], service: null };

      const txCache = await cacheGet<BudgetTransaction[]>(
        ctx.db,
        active,
        "transactions",
      );
      if (!txCache) return { categories: [], service: active };

      const client = await getClientForService(ctx.db, active);
      const excludedCategories =
        client?.getExcludedCategoryNames() ?? new Set();
      const incomeIds = await cachedIncomeCategoryIds(ctx.db, active);
      const transactions = txCache.data.filter(
        (t) =>
          !t.deleted &&
          t.categoryName &&
          !excludedCategories.has(t.categoryName) &&
          !(t.categoryId && incomeIds.has(t.categoryId)),
      );

      // Group by category, split into current vs prior
      const categoryData = new Map<
        string,
        { current: number; prior: number }
      >();

      for (const tx of transactions) {
        const catName = tx.categoryName!;
        const entry = categoryData.get(catName) ?? { current: 0, prior: 0 };

        if (tx.date >= input.currentStart && tx.date <= input.currentEnd) {
          entry.current += tx.amount;
        } else if (tx.date >= input.priorStart && tx.date <= input.priorEnd) {
          entry.prior += tx.amount;
        }

        categoryData.set(catName, entry);
      }

      const categories = Array.from(categoryData.entries())
        .map(([name, { current, prior }]) => {
          const changeRatio = safeDivide(
            current - prior,
            Math.abs(prior),
            null,
          );
          return {
            name,
            current,
            prior,
            diff: current - prior,
            percentChange: changeRatio === null ? null : changeRatio * 100,
          };
        })
        .filter((c) => c.current !== 0 || c.prior !== 0)
        .sort((a, b) => Math.abs(b.current) - Math.abs(a.current));

      return { categories, service: active };
    }),
};
