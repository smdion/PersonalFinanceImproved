import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, budgetProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  loadBudgetItemLinks,
  setBudgetItemLink,
  deleteBudgetItemLink,
} from "@/server/data/category-links";
import { resolveTargetBudgetProfile } from "@/server/data/budget-profiles";
import { budgetApiServiceSchema } from "@/lib/config/enum-values.schema";
import {
  getActiveBudgetApi,
  cacheGet,
  YNAB_INTERNAL_GROUPS,
} from "@/lib/budget-api";
import type { BudgetCategoryGroup, BudgetMonthDetail } from "@/lib/budget-api";
import { currentMonthKey } from "@/lib/utils/date-keys";

export const apiLinkProcedures = {
  // ── Budget API Integration ──

  /** Get cached categories from the active (or specified) budget API for the category picker. */
  listApiCategories: protectedProcedure
    .input(z.object({ service: budgetApiServiceSchema.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const active = await getActiveBudgetApi(ctx.db);
      const service = input?.service ?? (active !== "none" ? active : null);
      if (!service) return { groups: [] };

      const cached = await cacheGet<BudgetCategoryGroup[]>(
        ctx.db,
        service,
        "categories",
      );
      if (!cached) return { groups: [] };

      // Flatten to group > category hierarchy, excluding hidden and YNAB internal groups
      return {
        groups: cached.data
          .filter((g) => !g.hidden && !YNAB_INTERNAL_GROUPS.has(g.name))
          .map((g) => ({
            id: g.id,
            name: g.name,
            categories: g.categories
              .filter((c) => !c.hidden)
              .map((c) => ({
                id: c.id,
                name: c.name,
                budgeted: c.budgeted,
                activity: c.activity,
                balance: c.balance,
              })),
          })),
      };
    }),

  /** Link a budget item to a budget API category. */
  linkToApi: budgetProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        service: budgetApiServiceSchema,
        apiCategoryId: z.string().min(1),
        apiCategoryName: z.string().min(1),
        syncDirection: z.enum(["pull", "push", "both"]).default("pull"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await setBudgetItemLink(ctx.db, {
        budgetItemId: input.budgetItemId,
        service: input.service,
        categoryId: input.apiCategoryId,
        categoryName: input.apiCategoryName,
        syncDirection: input.syncDirection,
        lastSyncedAt: null,
      });
      return { ok: true };
    }),

  /** Remove API link from a budget item. */
  unlinkFromApi: budgetProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        service: budgetApiServiceSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await deleteBudgetItemLink(ctx.db, {
        budgetItemId: input.budgetItemId,
        service: input.service,
      });
      return { ok: true };
    }),

  /** Change sync direction on a linked budget item. */
  setSyncDirection: budgetProcedure
    .input(
      z.object({
        budgetItemId: z.number(),
        service: budgetApiServiceSchema,
        syncDirection: z.enum(["pull", "push", "both"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const links = await loadBudgetItemLinks(
        ctx.db,
        [input.budgetItemId],
        input.service,
      );
      const existing = links.get(input.budgetItemId);
      if (!existing) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Budget item is not linked to this service",
        });
      }
      await setBudgetItemLink(ctx.db, {
        budgetItemId: input.budgetItemId,
        service: input.service,
        categoryId: existing.categoryId,
        categoryName: existing.categoryName,
        syncDirection: input.syncDirection,
        lastSyncedAt: existing.lastSyncedAt,
      });
      return { ok: true };
    }),

  /** Get API actuals for linked budget items (activity + balance from cached month data). */
  listApiActuals: protectedProcedure
    .input(z.object({ profileId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none")
        return {
          actuals: [],
          service: null as string | null,
          month: null as string | null,
          linkedProfileId: null as number | null,
          linkedColumnIndex: 0,
        };

      const now = ctx.scope.asOf;
      const currentMonth = currentMonthKey(now);
      const monthCache = await cacheGet<BudgetMonthDetail>(
        ctx.db,
        active,
        `months/${currentMonth}`,
      );
      if (!monthCache)
        return {
          actuals: [],
          service: active,
          month: null as string | null,
          linkedProfileId: null as number | null,
          linkedColumnIndex: 0,
        };

      const apiCategories = new Map(
        monthCache.data.categories.map((c) => [c.id, c]),
      );

      const profile = await resolveTargetBudgetProfile(
        ctx.db,
        input?.profileId,
      );
      if (!profile)
        return {
          actuals: [],
          service: active,
          month: null as string | null,
          linkedProfileId: null as number | null,
          linkedColumnIndex: 0,
        };

      const actualsItemRows = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      const actualsItemLinks = await loadBudgetItemLinks(
        ctx.db,
        actualsItemRows.map((i) => i.id),
        active,
      );
      const items = actualsItemRows.map((i) => {
        const link = actualsItemLinks.get(i.id);
        return {
          ...i,
          apiCategoryId: link?.categoryId ?? null,
          apiCategoryName: link?.categoryName ?? null,
        };
      });

      const actuals = items
        .filter((i) => i.apiCategoryId)
        .map((i) => {
          const cat = apiCategories.get(i.apiCategoryId!);
          return {
            budgetItemId: i.id,
            apiCategoryName: i.apiCategoryName,
            budgeted: cat?.budgeted ?? 0,
            activity: cat?.activity ?? 0,
            balance: cat?.balance ?? 0,
            goalTarget: cat?.goalTarget ?? 0,
          };
        });

      // Include linked profile/column info so UI can highlight which profile + mode syncs
      const conn = await ctx.db
        .select({
          linkedProfileId: schema.apiConnections.linkedProfileId,
          linkedColumnIndex: schema.apiConnections.linkedColumnIndex,
        })
        .from(schema.apiConnections)
        .where(eq(schema.apiConnections.service, active))
        .limit(1);

      return {
        actuals,
        month: currentMonth,
        service: active,
        linkedProfileId: conn[0]?.linkedProfileId ?? null,
        linkedColumnIndex: conn[0]?.linkedColumnIndex ?? 0,
      };
    }),
};
