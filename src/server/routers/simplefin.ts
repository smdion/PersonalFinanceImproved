/**
 * SimpleFIN router — daily linked-balance pulse (Phase 1).
 *
 * Deliberately separate from ./sync (the YNAB/Actual BudgetAPIClient
 * group): SimpleFIN is a read-only bank/brokerage balance aggregator with
 * no budget/category/transaction concepts, so it doesn't implement the
 * BudgetAPIClient interface or go through lib/budget-api/factory.ts.
 *
 * Mutations use syncProcedure (same permission domain as YNAB/Actual
 * connection management in sync/connections.ts) since they write shared
 * server-side credentials and trigger external syncs. Queries use
 * protectedProcedure — read-only, no reason to gate more tightly.
 */

import { z } from "zod/v4";
import { desc, gte } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, syncProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  getSimplefinConnection,
  saveSimplefinConnection,
  removeSimplefinConnection,
  runSimplefinSync,
} from "@/lib/simplefin/sync";
import { claimSetupToken, getAccounts } from "@/lib/simplefin/client";
import { readMaybeEncrypted } from "@/lib/crypto";
import type { SimplefinConfig } from "@/lib/simplefin/sync";
import { TRPCError } from "@trpc/server";

export const simplefinRouter = createTRPCRouter({
  /** Claim a one-time setup token and store the resulting access URL. */
  saveToken: syncProcedure
    .input(z.object({ setupToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const accessUrl = await claimSetupToken(input.setupToken);
        await saveSimplefinConnection(ctx.db, accessUrl);
        return { success: true as const };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to claim SimpleFIN setup token: ${msg.slice(0, 200)}`,
        });
      }
    }),

  /** Test the stored connection without writing a snapshot. */
  testConnection: syncProcedure.mutation(async ({ ctx }) => {
    const conn = await getSimplefinConnection(ctx.db);
    if (!conn) {
      return {
        success: false as const,
        error: "No SimpleFIN connection configured",
      };
    }
    try {
      const { accessUrl } = readMaybeEncrypted<SimplefinConfig>(conn.config);
      const accounts = await getAccounts(accessUrl);
      return { success: true as const, accountCount: accounts.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return { success: false as const, error: msg.slice(0, 200) };
    }
  }),

  /** Manual sync trigger — calls the same runSimplefinSync the daily cron calls. */
  syncNow: syncProcedure.mutation(async ({ ctx }) => {
    try {
      return { success: true as const, ...(await runSimplefinSync(ctx.db)) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `SimpleFIN sync failed: ${msg.slice(0, 200)}`,
      });
    }
  }),

  /** Remove the stored connection (history in simplefin_balance_snapshots is preserved). */
  removeConnection: syncProcedure.mutation(async ({ ctx }) => {
    await removeSimplefinConnection(ctx.db);
    return { success: true as const };
  }),

  /** Connection status for the Settings integrations card. */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const conn = await getSimplefinConnection(ctx.db);
    if (!conn) {
      return { connected: false as const, lastSyncedAt: null };
    }
    return {
      connected: true as const,
      lastSyncedAt: conn.lastSyncedAt,
    };
  }),

  /** Snapshot history for the dashboard sparkline. */
  listBalanceHistory: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setDate(since.getDate() - input.days);
      const sinceStr = since.toISOString().slice(0, 10);

      const rows = await ctx.db
        .select()
        .from(schema.simplefinBalanceSnapshots)
        .where(gte(schema.simplefinBalanceSnapshots.snapshotDate, sinceStr))
        .orderBy(desc(schema.simplefinBalanceSnapshots.snapshotDate));

      return rows
        .map((r) => ({
          snapshotDate: r.snapshotDate,
          totalBalance: Number(r.totalBalance),
          accountCount: r.accountCount,
        }))
        .reverse();
    }),
});
