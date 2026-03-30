/** Brokerage router for managing taxable investment goals and API-linked account balances. */
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  brokerageProcedure,
  adminProcedure,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/server/helpers";
import {
  getApiAccountBalanceMap,
  resolveAccountBalance,
} from "@/server/helpers/api-balance-resolution";
import {
  getActiveBudgetApi,
  getApiConnection,
  cacheGet,
} from "@/lib/budget-api";
import type { BudgetAccount } from "@/lib/budget-api";

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
    const goals = await ctx.db
      .select()
      .from(schema.brokerageGoals)
      .where(eq(schema.brokerageGoals.isActive, true))
      .orderBy(
        asc(schema.brokerageGoals.targetYear),
        asc(schema.brokerageGoals.priority),
      );

    // Resolve API balances for linked portfolio accounts
    const apiBalances: Array<{
      performanceAccountId: number;
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
            const snapshotAccounts = await ctx.db
              .select()
              .from(schema.portfolioAccounts)
              .where(
                eq(schema.portfolioAccounts.snapshotId, latestSnapshot.id),
              );

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
    };
  }),

  // ══ API LINKING ══

  /** Get available YNAB tracking accounts for linking. */
  availableTrackingAccounts: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") return { accounts: [], mappings: [], service: null };

    const cached = await cacheGet<BudgetAccount[]>(ctx.db, active, "accounts");
    if (!cached) return { accounts: [], mappings: [], service: active };

    // Return tracking (off-budget) accounts — these are investment/asset accounts in YNAB
    const tracking = cached.data.filter((a) => !a.onBudget && !a.closed);

    // Also return current mappings so the UI knows which are already linked
    const conn = await getApiConnection(ctx.db, active);
    const mappings = (conn?.accountMappings ?? []).filter(
      (m) => m.performanceAccountId != null,
    );

    return {
      accounts: tracking.map((a) => ({
        id: a.id,
        name: a.name,
        balance: a.balance,
        type: a.type,
      })),
      mappings: mappings.map((m) => ({
        performanceAccountId: m.performanceAccountId!,
        remoteAccountId: m.remoteAccountId,
        syncDirection: m.syncDirection,
        localName: m.localName,
      })),
      service: active,
    };
  }),

  /** Link a performance account to a YNAB tracking account. */
  linkAccount: adminProcedure
    .input(
      z.object({
        performanceAccountId: z.number().int(),
        remoteAccountId: z.string().min(1),
        syncDirection: z.enum(["pull", "push", "both"]).default("pull"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none") {
        throw new Error("No budget API active");
      }

      const conn = await getApiConnection(ctx.db, active);
      const mappings = conn?.accountMappings ?? [];

      // Get the performance account for the display name
      const perfAcct = await ctx.db
        .select()
        .from(schema.performanceAccounts)
        .where(eq(schema.performanceAccounts.id, input.performanceAccountId))
        .then((r) => r[0]);

      // Remove any existing mapping for this performanceAccountId
      const updated = mappings.filter(
        (m) => m.performanceAccountId !== input.performanceAccountId,
      );

      // Add the new mapping
      updated.push({
        localId: `performance:${input.performanceAccountId}`,
        localName:
          perfAcct?.accountLabel ?? `Account ${input.performanceAccountId}`,
        remoteAccountId: input.remoteAccountId,
        syncDirection: input.syncDirection,
        performanceAccountId: input.performanceAccountId,
      });

      await ctx.db
        .update(schema.apiConnections)
        .set({ accountMappings: updated })
        .where(eq(schema.apiConnections.service, active));

      return { ok: true };
    }),

  /** Unlink a performance account from its YNAB tracking account. */
  unlinkAccount: adminProcedure
    .input(z.object({ performanceAccountId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none") {
        throw new Error("No budget API active");
      }

      const conn = await getApiConnection(ctx.db, active);
      const mappings = conn?.accountMappings ?? [];
      const updated = mappings.filter(
        (m) => m.performanceAccountId !== input.performanceAccountId,
      );

      await ctx.db
        .update(schema.apiConnections)
        .set({ accountMappings: updated })
        .where(eq(schema.apiConnections.service, active));

      return { ok: true };
    }),
});
