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
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, syncProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  getSimplefinConnection,
  saveSimplefinConnection,
  removeSimplefinConnection,
  runSimplefinSync,
  upsertSimplefinAccounts,
  recomputeTodaySnapshotFromLocal,
} from "@/lib/simplefin/sync";
import { claimSetupToken, getAccounts } from "@/lib/simplefin/client";
import { readMaybeEncrypted } from "@/lib/crypto";
import type { SimplefinConfig } from "@/lib/simplefin/sync";
import { getLatestSnapshot } from "@/server/helpers/snapshot";
import { accountDisplayName } from "@/lib/utils/format";
import {
  isRetirementParent,
  isPortfolioParent,
} from "@/lib/config/account-types";
import type { ParentCategory } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types.types";
import type { PortfolioTaxType } from "@/lib/config/enum-values";
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
      await upsertSimplefinAccounts(ctx.db, accounts);
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

  /**
   * All known linked accounts, for the Settings include/exclude + match
   * list. For accounts matched to a performance_accounts row (via
   * setAccountMapping), also attaches the latest weekly snapshot's
   * balance for that account and a live-vs-snapshot delta — display
   * only, this never writes to the snapshot.
   *
   * Matching is many-to-one (multiple SimpleFIN accounts can point at the
   * same performance account — e.g. a historical account split/merge that
   * Ledgr still tracks as one account), so the delta is computed at the
   * matched-group level: every SimpleFIN account linked to a given
   * performance account shares the same `change`, comparing their
   * *combined* live balance against that one snapshot balance. A per-row
   * delta would be meaningless here since no single SimpleFIN account
   * necessarily represents the whole tracked account on its own.
   */
  listAccounts: protectedProcedure.query(async ({ ctx }) => {
    const [rows, latest] = await Promise.all([
      ctx.db
        .select()
        .from(schema.simplefinAccounts)
        .orderBy(
          asc(schema.simplefinAccounts.orgName),
          asc(schema.simplefinAccounts.accountName),
        ),
      getLatestSnapshot(ctx.db),
    ]);

    // Same filter-and-sum idiom as sync/mappings.ts's pullPortfolioFromApi —
    // a performance account can be split across multiple snapshot rows
    // (e.g. by tax type), so sum every row that shares its id.
    const snapshotBalanceByPerfId = new Map<number, number>();
    const taxTypesSeenByPerfId = new Map<number, Set<PortfolioTaxType>>();
    const parentCategoryByPerfId = new Map<number, ParentCategory>();
    // accountType/subType are single canonical fields on the performance_accounts
    // master row (not split per snapshot row like tax type can be), so every
    // snapshot row sharing a performanceAccountId carries an identical value —
    // plain overwrite is safe here, unlike the tax-type "mixed" case below.
    const accountTypeByPerfId = new Map<number, AccountCategory>();
    const subTypeByPerfId = new Map<number, string | null>();
    if (latest) {
      for (const a of latest.accounts) {
        if (a.performanceAccountId == null) continue;
        snapshotBalanceByPerfId.set(
          a.performanceAccountId,
          (snapshotBalanceByPerfId.get(a.performanceAccountId) ?? 0) + a.amount,
        );
        const taxTypes =
          taxTypesSeenByPerfId.get(a.performanceAccountId) ?? new Set();
        taxTypes.add(a.taxType as PortfolioTaxType);
        taxTypesSeenByPerfId.set(a.performanceAccountId, taxTypes);
        if (
          isRetirementParent(a.parentCategory ?? undefined) ||
          isPortfolioParent(a.parentCategory ?? undefined)
        ) {
          parentCategoryByPerfId.set(
            a.performanceAccountId,
            a.parentCategory as ParentCategory,
          );
        }
        accountTypeByPerfId.set(a.performanceAccountId, a.accountType);
        subTypeByPerfId.set(a.performanceAccountId, a.subType);
      }
    }
    // A performanceAccountId split across >1 distinct tax types in this
    // snapshot (e.g. a 401k with both Traditional and Roth buckets) has no
    // single correct tax type — resolve to "mixed" rather than silently
    // picking one and misattributing the whole balance to it.
    const taxTypeByPerfId = new Map<number, PortfolioTaxType | "mixed">();
    for (const [perfId, taxTypes] of taxTypesSeenByPerfId) {
      const [only] = taxTypes;
      taxTypeByPerfId.set(perfId, taxTypes.size === 1 && only ? only : "mixed");
    }

    // Group every currently-linked SimpleFIN account's balance by target
    // performanceAccountId, since more than one can point at the same id.
    const linkedTotalByPerfId = new Map<number, number>();
    for (const r of rows) {
      if (r.linkedPerformanceAccountId == null) continue;
      linkedTotalByPerfId.set(
        r.linkedPerformanceAccountId,
        (linkedTotalByPerfId.get(r.linkedPerformanceAccountId) ?? 0) +
          Number(r.lastBalance),
      );
    }

    const snapshotDate = latest?.snapshot.snapshotDate ?? null;

    return rows.map((r) => {
      const lastBalance = Number(r.lastBalance);
      const base = {
        id: r.id,
        orgName: r.orgName,
        accountName: r.accountName,
        lastBalance,
        isIncluded: r.isIncluded,
        lastSeenAt: r.lastSeenAt,
        linkedPerformanceAccountId: r.linkedPerformanceAccountId,
        snapshotDate,
      };
      if (r.linkedPerformanceAccountId == null) {
        return {
          ...base,
          snapshotBalance: null,
          change: null,
          taxType: null,
          parentCategory: null,
          accountType: null,
          subType: null,
        };
      }
      const snapshotBalance =
        snapshotBalanceByPerfId.get(r.linkedPerformanceAccountId) ?? 0;
      const linkedTotal =
        linkedTotalByPerfId.get(r.linkedPerformanceAccountId) ?? lastBalance;
      return {
        ...base,
        snapshotBalance,
        change: linkedTotal - snapshotBalance,
        taxType: taxTypeByPerfId.get(r.linkedPerformanceAccountId) ?? null,
        parentCategory:
          parentCategoryByPerfId.get(r.linkedPerformanceAccountId) ?? null,
        accountType:
          accountTypeByPerfId.get(r.linkedPerformanceAccountId) ?? null,
        subType: subTypeByPerfId.get(r.linkedPerformanceAccountId) ?? null,
      };
    });
  }),

  /** Active performance_accounts, for the match-to-existing-account picker. */
  listMatchableAccounts: protectedProcedure.query(async ({ ctx }) => {
    const [accounts, people] = await Promise.all([
      ctx.db
        .select()
        .from(schema.performanceAccounts)
        .where(eq(schema.performanceAccounts.isActive, true))
        .orderBy(
          asc(schema.performanceAccounts.displayOrder),
          asc(schema.performanceAccounts.id),
        ),
      ctx.db.select().from(schema.people),
    ]);
    const peopleMap = new Map(people.map((p) => [p.id, p.name]));
    return accounts.map((a) => ({
      id: a.id,
      label: accountDisplayName(
        a,
        a.ownerPersonId != null ? peopleMap.get(a.ownerPersonId) : undefined,
      ),
    }));
  }),

  /**
   * Match (or unmatch) a SimpleFIN account to an existing performance_accounts
   * row, so listAccounts can show live-vs-snapshot drift. Many-to-one:
   * multiple SimpleFIN accounts can point at the same performance account
   * (e.g. historical account splits/merges Ledgr still tracks as a single
   * account) — listAccounts sums every linked account's balance before
   * comparing against the snapshot, so this intentionally does NOT unlink
   * any other account pointed at the same target.
   */
  setAccountMapping: syncProcedure
    .input(
      z.object({
        id: z.number().int(),
        performanceAccountId: z.number().int().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.performanceAccountId != null) {
        const [target] = await ctx.db
          .select({ id: schema.performanceAccounts.id })
          .from(schema.performanceAccounts)
          .where(
            and(
              eq(schema.performanceAccounts.id, input.performanceAccountId),
              eq(schema.performanceAccounts.isActive, true),
            ),
          )
          .limit(1);
        if (!target) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Performance account not found or inactive",
          });
        }
      }

      const [row] = await ctx.db
        .update(schema.simplefinAccounts)
        .set({ linkedPerformanceAccountId: input.performanceAccountId })
        .where(eq(schema.simplefinAccounts.id, input.id))
        .returning();

      return {
        success: true as const,
        linkedPerformanceAccountId: row?.linkedPerformanceAccountId ?? null,
      };
    }),

  /**
   * Toggle an account's inclusion and recompute today's total from local
   * data immediately — no SimpleFIN API call, so this is free to click
   * repeatedly. Does not touch any prior day's snapshot.
   */
  setAccountIncluded: syncProcedure
    .input(z.object({ id: z.number().int(), isIncluded: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.simplefinAccounts)
        .set({ isIncluded: input.isIncluded })
        .where(eq(schema.simplefinAccounts.id, input.id));
      return {
        success: true as const,
        ...(await recomputeTodaySnapshotFromLocal(ctx.db)),
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
