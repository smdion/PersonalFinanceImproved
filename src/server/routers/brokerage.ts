/** Brokerage router for managing taxable investment goals and API-linked account balances. */
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  brokerageProcedure,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/server/helpers";
import {
  getApiAccountBalanceMap,
  resolveAccountBalance,
} from "@/server/helpers/api-balance-resolution";
import { getActiveBudgetApi, getApiConnection } from "@/lib/budget-api";

export const brokerageRouter = createTRPCRouter({
  // ══ GOALS ══

  listGoals: protectedProcedure.query(async ({ ctx }) => {
    const goals = await ctx.db
      .select()
      .from(schema.brokerageGoals)
      .where(eq(schema.brokerageGoals.isActive, true))
      .orderBy(
        asc(schema.brokerageGoals.targetYear),
        asc(schema.brokerageGoals.priority),
      );
    return goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetAmount: toNumber(g.targetAmount),
      targetYear: g.targetYear,
      priority: g.priority,
      isActive: g.isActive,
      notes: g.notes,
    }));
  }),

  createGoal: brokerageProcedure
    .input(
      z.object({
        name: z.string().min(1),
        targetAmount: z
          .string()
          .refine((v) => !isNaN(Number(v)) && Number(v) > 0),
        targetYear: z.number().int().min(new Date().getFullYear()),
        priority: z.number().int().default(0),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.brokerageGoals)
        .values({
          name: input.name,
          targetAmount: input.targetAmount,
          targetYear: input.targetYear,
          priority: input.priority,
          notes: input.notes ?? null,
        })
        .returning();
      return row;
    }),

  updateGoal: brokerageProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(1).optional(),
        targetAmount: z
          .string()
          .refine((v) => !isNaN(Number(v)) && Number(v) > 0)
          .optional(),
        targetYear: z.number().int().optional(),
        priority: z.number().int().optional(),
        isActive: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      await ctx.db
        .update(schema.brokerageGoals)
        .set(updates)
        .where(eq(schema.brokerageGoals.id, id));
      return { ok: true };
    }),

  deleteGoal: brokerageProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.brokerageGoals)
        .where(eq(schema.brokerageGoals.id, input.id));
      return { ok: true };
    }),

  // ══ SUMMARY (goals + API-resolved balances for brokerage page) ══

  computeSummary: protectedProcedure.query(async ({ ctx }) => {
    const [goals, budgetLinkRows, costBasisSetting] = await Promise.all([
      ctx.db
        .select()
        .from(schema.brokerageGoals)
        .where(eq(schema.brokerageGoals.isActive, true))
        .orderBy(
          asc(schema.brokerageGoals.targetYear),
          asc(schema.brokerageGoals.priority),
        ),
      // Budget links: which contribution accounts have a linked budget item?
      ctx.db
        .select({
          contributionAccountId: schema.budgetItems.contributionAccountId,
          budgetItemName: schema.budgetItems.subcategory,
          budgetCategory: schema.budgetItems.category,
          accountType: schema.contributionAccounts.accountType,
        })
        .from(schema.budgetItems)
        .innerJoin(
          schema.contributionAccounts,
          eq(
            schema.budgetItems.contributionAccountId,
            schema.contributionAccounts.id,
          ),
        ),
      // Cost basis setting for brokerage page display
      ctx.db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "brokerage_cost_basis"))
        .then((r) => r[0]?.value ?? null),
    ]);

    // Resolve API balances for linked portfolio accounts
    const apiBalances: Array<{
      performanceAccountId: number;
      accountCategory: string;
      resolvedBalance: number;
      snapshotBalance: number;
      source: "api" | "snapshot";
    }> = [];

    try {
      const active = await getActiveBudgetApi(ctx.db);
      if (active !== "none") {
        const conn = await getApiConnection(ctx.db, active);
        const mappings = (conn?.accountMappings ?? []).filter(
          (m) => m.performanceAccountId != null,
        );

        if (mappings.length > 0) {
          // Get latest snapshot accounts
          const latestSnapshot = await ctx.db
            .select()
            .from(schema.portfolioSnapshots)
            .orderBy(sql`${schema.portfolioSnapshots.snapshotDate} DESC`)
            .limit(1)
            .then((r) => r[0]);

          if (latestSnapshot) {
            const [snapshotAccounts, perfAccounts] = await Promise.all([
              ctx.db
                .select()
                .from(schema.portfolioAccounts)
                .where(
                  eq(schema.portfolioAccounts.snapshotId, latestSnapshot.id),
                ),
              ctx.db.select().from(schema.performanceAccounts),
            ]);
            const perfAccountMap = new Map(perfAccounts.map((p) => [p.id, p]));

            const apiBalanceMap = await getApiAccountBalanceMap(ctx.db, active);

            // Aggregate snapshot balances by performanceAccountId
            const balanceByPerfId = new Map<number, number>();
            for (const acct of snapshotAccounts) {
              if (!acct.performanceAccountId) continue;
              balanceByPerfId.set(
                acct.performanceAccountId,
                (balanceByPerfId.get(acct.performanceAccountId) ?? 0) +
                  Number(acct.amount),
              );
            }

            // Build mapping lookup by performanceAccountId
            const mappingByPerfId = new Map(
              mappings.map((m) => [m.performanceAccountId!, m]),
            );

            // Resolve each performance account's balance
            for (const [perfId, snapshotBal] of balanceByPerfId) {
              const mapping = mappingByPerfId.get(perfId);
              const resolved = resolveAccountBalance(
                snapshotBal,
                mapping,
                apiBalanceMap,
              );
              apiBalances.push({
                performanceAccountId: perfId,
                accountCategory:
                  perfAccountMap.get(perfId)?.accountType ?? "brokerage",
                resolvedBalance: resolved.balance,
                snapshotBalance: snapshotBal,
                source: resolved.source,
              });
            }
          }
        }
      }
    } catch {
      // API resolution is best-effort — fall back to snapshot balances
    }

    return {
      goals: goals.map((g) => ({
        id: g.id,
        name: g.name,
        targetAmount: toNumber(g.targetAmount),
        targetYear: g.targetYear,
        priority: g.priority,
        isActive: g.isActive,
        notes: g.notes,
      })),
      apiBalances,
      budgetLinks: budgetLinkRows
        .filter((r) => r.contributionAccountId != null)
        .map((r) => ({
          accountType: r.accountType,
          budgetItemName: r.budgetItemName,
          budgetCategory: r.budgetCategory,
        })),
      costBasis:
        costBasisSetting != null
          ? Number(String(costBasisSetting).replace(/"/g, ""))
          : 0,
    };
  }),
});
