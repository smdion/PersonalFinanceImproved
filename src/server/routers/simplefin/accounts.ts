import { z } from "zod/v4";
import { desc, eq, gte } from "drizzle-orm";
import { adminProcedure, protectedProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { recomputeTodaySnapshotFromLocal } from "@/server/services/sync/simplefin/sync";
import { calendarDateOf } from "@/lib/utils/calendar-date";
import {
  applyLoanFeedBalances,
  clearLoanBalance,
} from "@/server/services/sync/loan-feed";
import { TRPCError } from "@trpc/server";
import { listSimplefinAccounts } from "@/server/services/sync/simplefin";

export const accountsProcedures = {
  /**
   * Linked accounts for the Settings include/exclude + match list. Matched accounts get the
   * latest snapshot balance and a display-only drift `change`, computed per performance
   * account: every SimpleFIN account linked to it shares the combined-balance delta.
   */
  listAccounts: protectedProcedure.query(({ ctx }) =>
    listSimplefinAccounts(ctx),
  ),

  /**
   * Toggle an account's inclusion and recompute today's total from local
   * data immediately — no SimpleFIN API call, so this is free to click
   * repeatedly. Does not touch any prior day's snapshot.
   */
  setAccountIncluded: adminProcedure
    .input(z.object({ id: z.number().int(), isIncluded: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(schema.simplefinAccounts)
        .set({ isIncluded: input.isIncluded })
        .where(eq(schema.simplefinAccounts.id, input.id))
        .returning();

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SimpleFIN account not found",
        });
      }

      // Unchecked is unlinked as far as the loan goes; budget pulls resume.
      if (row.linkedLoanId != null) {
        if (input.isIncluded) await applyLoanFeedBalances(ctx.db);
        else await clearLoanBalance(ctx.db, row.linkedLoanId);
      }

      return {
        ok: true as const,
        ...(await recomputeTodaySnapshotFromLocal(ctx.db, ctx.scope.asOf)),
      };
    }),

  /** Snapshot history for the dashboard sparkline. */
  listBalanceHistory: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const since = new Date(ctx.scope.asOf);
      since.setDate(since.getDate() - input.days);
      const sinceStr = calendarDateOf(since);

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
};
