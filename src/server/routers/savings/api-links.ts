import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, savingsProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  loadSavingsGoalLinks,
  setSavingsGoalLink,
  deleteSavingsGoalLink,
} from "@/server/data/category-links";
import { budgetApiServiceSchema } from "@/lib/config/enum-values.schema";
import { getActiveBudgetApi, cacheGet } from "@/lib/budget-api";

export const apiLinkProcedures = {
  // ══ API CATEGORY SYNC ══

  /** Link a savings goal to a budget API category. */
  linkGoalToApi: savingsProcedure
    .input(
      z.object({
        goalId: z.number().int(),
        service: budgetApiServiceSchema,
        apiCategoryId: z.string().min(1),
        apiCategoryName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // One fund per category: two would each push their own target to it,
      // and the last push would win.
      const goals = await ctx.db
        .select({ id: schema.savingsGoals.id, name: schema.savingsGoals.name })
        .from(schema.savingsGoals);
      const links = await loadSavingsGoalLinks(
        ctx.db,
        goals.map((g) => g.id),
        input.service,
        "primary",
      );
      const taken = goals.find(
        (g) =>
          g.id !== input.goalId &&
          links.get(g.id)?.categoryId === input.apiCategoryId,
      );
      if (taken)
        throw new TRPCError({
          code: "CONFLICT",
          message: `${taken.name} is already linked to that category`,
        });
      await setSavingsGoalLink(ctx.db, {
        savingsGoalId: input.goalId,
        service: input.service,
        role: "primary",
        categoryId: input.apiCategoryId,
        categoryName: input.apiCategoryName,
      });
      return { ok: true };
    }),

  /** Unlink a savings goal from a budget API category. */
  unlinkGoalFromApi: savingsProcedure
    .input(
      z.object({
        goalId: z.number().int(),
        service: budgetApiServiceSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await deleteSavingsGoalLink(ctx.db, {
        savingsGoalId: input.goalId,
        service: input.service,
        role: "primary",
      });
      return { ok: true };
    }),

  /** Get API category balances for linked savings goals (for display). */
  listApiBalances: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") return { balances: [], service: null };

    const categoriesCache = await cacheGet(ctx.db, active, "categories");
    if (!categoriesCache) return { balances: [], service: active };

    const catMap = new Map<
      string,
      {
        balance: number;
        budgeted: number;
        activity: number;
        goalTarget?: number;
      }
    >();
    for (const group of categoriesCache.data) {
      for (const cat of group.categories) {
        catMap.set(cat.id, {
          balance: cat.balance,
          budgeted: cat.budgeted,
          activity: cat.activity,
          goalTarget: cat.goalTarget,
        });
      }
    }

    const goals = await ctx.db.select().from(schema.savingsGoals);
    const balancesGoalLinks = await loadSavingsGoalLinks(
      ctx.db,
      goals.map((g) => g.id),
      active,
      "primary",
    );
    const balances = goals
      .map((g) => ({ ...g, link: balancesGoalLinks.get(g.id) }))
      .filter((g) => g.link)
      .map((g) => {
        const cat = catMap.get(g.link!.categoryId);
        return {
          goalId: g.id,
          apiCategoryName: g.link!.categoryName,
          balance: cat?.balance ?? 0,
          budgeted: cat?.budgeted ?? 0,
          activity: cat?.activity ?? 0,
          goalTarget: cat?.goalTarget ?? null,
        };
      });

    return { balances, service: active };
  }),
};
