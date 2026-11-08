import { z } from "zod/v4";
import { asc, desc, eq, gte } from "drizzle-orm";
import { adminProcedure, protectedProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  recomputeTodaySnapshotFromLocal,
  localDateStr,
} from "@/lib/simplefin/sync";
import { countsAsFeed, isUnclaimedDebt } from "@/lib/pure/sync/simplefin-feeds";
import {
  applyLoanFeedBalances,
  clearLoanBalance,
} from "@/server/services/sync/loan-feed";
import { getLatestSnapshot } from "@/server/data/snapshots";
import { roundToCents } from "@/lib/utils/math";
import {
  isRetirementParent,
  isPortfolioParent,
} from "@/lib/config/account-types";
import type { ParentCategory } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import type { PortfolioTaxType } from "@/lib/config/enum-values";
import { TRPCError } from "@trpc/server";
import { loadLinkContext } from "@/server/services/sync/simplefin";

export const accountsProcedures = {
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

    // A performance account can be split across multiple snapshot rows
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

    // Group every counted (linked and included) SimpleFIN account's balance
    // by target performanceAccountId, since more than one can point at the
    // same id. Unchecked accounts count for nothing — see countsAsFeed.
    const linkedTotalByPerfId = new Map<number, number>();
    const linkedTotalBySubKey = new Map<string, number>();
    for (const r of rows) {
      if (!countsAsFeed(r) || r.linkedPerformanceAccountId == null) continue;
      if (r.linkedSubKey)
        linkedTotalBySubKey.set(
          r.linkedSubKey,
          (linkedTotalBySubKey.get(r.linkedSubKey) ?? 0) +
            Number(r.lastBalance),
        );
      linkedTotalByPerfId.set(
        r.linkedPerformanceAccountId,
        (linkedTotalByPerfId.get(r.linkedPerformanceAccountId) ?? 0) +
          Number(r.lastBalance),
      );
    }

    const snapshotDate = latest?.snapshot.snapshotDate ?? null;
    const links = await loadLinkContext(ctx.db, rows);

    return rows.map((r) => {
      const lastBalance = Number(r.lastBalance);
      const base = {
        id: r.id,
        orgName: r.orgName,
        accountName: r.accountName,
        lastBalance,
        lastBalanceDate: r.lastBalanceDate,
        isIncluded: r.isIncluded,
        lastSeenAt: r.lastSeenAt,
        linkedPerformanceAccountId: r.linkedPerformanceAccountId,
        linkedLoanId: r.linkedLoanId,
        unclaimedDebt: isUnclaimedDebt(r),
        // The sub-account it's linked to; a key no longer in the latest
        // snapshot (edited or deactivated) is kept and flagged, and the
        // link counts for the whole account meanwhile.
        linkedSubKey:
          r.linkedPerformanceAccountId != null ? r.linkedSubKey : null,
        linkedSubLabel: r.linkedSubKey
          ? (links.subByKey.get(r.linkedSubKey)?.label ?? null)
          : null,
        subLinkMissing:
          r.linkedPerformanceAccountId != null &&
          !!r.linkedSubKey &&
          !links.subByKey.has(r.linkedSubKey),
        suggestion: links.suggestions.get(r.id) ?? null,
        /** Tax treatment (label) of a part this account needs but the tracked account lacks. */
        missingPart: links.missingParts.get(r.id) ?? null,
        snapshotDate,
      };
      if (r.linkedPerformanceAccountId == null || !countsAsFeed(r)) {
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
      // A feed linked to one part compares with that part, alongside only
      // the feeds sharing its key — never the whole account's total.
      const part = r.linkedSubKey
        ? links.subByKey.get(r.linkedSubKey)
        : undefined;
      const snapshotBalance = part
        ? part.amount
        : (snapshotBalanceByPerfId.get(r.linkedPerformanceAccountId) ?? null);
      const linkedTotal = part
        ? (linkedTotalBySubKey.get(r.linkedSubKey!) ?? lastBalance)
        : (linkedTotalByPerfId.get(r.linkedPerformanceAccountId) ??
          lastBalance);
      return {
        ...base,
        snapshotBalance,
        // Rounded to cents — a performanceAccountId with multiple linked
        // SimpleFIN rows (e.g. a 401k's Traditional + Roth sub-accounts)
        // sums their balances via float addition, which can leave a
        // sub-cent residue that's genuinely nonzero but renders as "$0.00"
        // — real incident: a category showed a "+$0.00" drift badge next
        // to sibling categories with no badge at all for a true zero.
        change:
          snapshotBalance == null
            ? null
            : roundToCents(linkedTotal - snapshotBalance),
        taxType: taxTypeByPerfId.get(r.linkedPerformanceAccountId) ?? null,
        parentCategory:
          parentCategoryByPerfId.get(r.linkedPerformanceAccountId) ?? null,
        accountType:
          accountTypeByPerfId.get(r.linkedPerformanceAccountId) ?? null,
        subType: subTypeByPerfId.get(r.linkedPerformanceAccountId) ?? null,
      };
    });
  }),

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
      const sinceStr = localDateStr(since);

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
