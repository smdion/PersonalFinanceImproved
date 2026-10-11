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
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, syncProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  getSimplefinConnection,
  saveSimplefinConnection,
  removeSimplefinConnection,
  runSimplefinSync,
  upsertSimplefinAccounts,
  recomputeTodaySnapshotFromLocal,
  localDateStr,
  getSimplefinLastError,
} from "@/lib/simplefin/sync";
import {
  claimSetupToken,
  getAccounts,
  isSimplefinReplayMode,
} from "@/lib/simplefin/client";
import {
  SIMPLEFIN_DAILY_REQUEST_LIMIT,
  SIMPLEFIN_MANUAL_SYNC_MIN_GAP_MS,
  countSimplefinRequestsLastDay,
  lastSimplefinRequestAt,
} from "@/lib/simplefin/request-log";
import { redactStoredCardSpending } from "@/lib/simplefin/ingest";
import { loadLatestSubAccounts } from "@/server/helpers/sub-accounts";
import { suggestLinks } from "@/lib/pure/simplefin-link-suggestions";
import { readMaybeEncrypted } from "@/lib/crypto";
import { summarizeBalanceDates } from "@/lib/pure/balance-dates";
import type { SimplefinConfig } from "@/lib/simplefin/sync";
import { getLatestSnapshot } from "@/server/helpers/snapshot";
import { accountDisplayName } from "@/lib/utils/format";
import { roundToCents } from "@/lib/utils/math";
import {
  isRetirementParent,
  isPortfolioParent,
} from "@/lib/config/account-types";
import type { ParentCategory } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types.types";
import type { PortfolioTaxType } from "@/lib/config/enum-values";
import { TRPCError } from "@trpc/server";

type LinkSuggestionView = {
  performanceAccountId: number;
  subKey: string | null;
  /** e.g. "IRA (Vanguard) — Sean — Roth" or "Alice 401k (Fidelity)". */
  label: string;
};

/**
 * Sub-accounts by key, and a suggested link for each unlinked SimpleFIN
 * account. Suggestions never take a sub-account (or whole account) the
 * household already linked.
 */
async function linkContext(
  db: Parameters<typeof loadLatestSubAccounts>[0],
  rows: (typeof schema.simplefinAccounts.$inferSelect)[],
) {
  const [subs, perf, people] = await Promise.all([
    loadLatestSubAccounts(db),
    db.select().from(schema.performanceAccounts),
    db
      .select({ id: schema.people.id, name: schema.people.name })
      .from(schema.people),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const perfLabel = new Map(
    perf.map((a) => [
      a.id,
      accountDisplayName(
        a,
        a.ownerPersonId != null ? names.get(a.ownerPersonId) : undefined,
      ),
    ]),
  );
  const subByKey = new Map(subs.map((sub) => [sub.key, sub]));
  const takenKeys = new Set(rows.map((r) => r.linkedSubKey).filter(Boolean));
  const takenWhole = new Set(
    rows
      .filter((r) => r.linkedPerformanceAccountId != null && !r.linkedSubKey)
      .map((r) => r.linkedPerformanceAccountId),
  );
  const open = subs.filter(
    (sub) =>
      !takenKeys.has(sub.key) && !takenWhole.has(sub.performanceAccountId),
  );
  const keyOf = new Map(open.map((sub) => [sub, sub.key]));
  const suggestions = new Map<number, LinkSuggestionView>();
  for (const s of suggestLinks(
    rows
      .filter((r) => r.linkedPerformanceAccountId == null)
      .map((r) => ({
        id: r.id,
        orgName: r.orgName,
        accountName: r.accountName,
        balance: Number(r.lastBalance),
      })),
    open,
  )) {
    const subKey =
      s.candidate.taxType === null
        ? null
        : (keyOf.get(s.candidate as (typeof open)[number]) ?? null);
    const account = perfLabel.get(s.candidate.performanceAccountId) ?? "";
    suggestions.set(s.simplefinAccountId, {
      performanceAccountId: s.candidate.performanceAccountId,
      subKey,
      label: subKey ? `${account} — ${subByKey.get(subKey)!.label}` : account,
    });
  }

  // An account linked to a whole tracked account whose name states one tax
  // treatment (e.g. a Roth IRA linked to an IRA holding two people's Roth
  // and traditional money) can be narrowed to that sub-account. Only that
  // tracked account's own free sub-accounts are considered.
  const wholeLinked = new Map<number, typeof rows>();
  for (const r of rows) {
    if (r.linkedPerformanceAccountId == null || r.linkedSubKey) continue;
    const list = wholeLinked.get(r.linkedPerformanceAccountId) ?? [];
    list.push(r);
    wholeLinked.set(r.linkedPerformanceAccountId, list);
  }
  for (const [performanceAccountId, linked] of wholeLinked) {
    const own = subs.filter(
      (sub) => sub.performanceAccountId === performanceAccountId,
    );
    if (own.length < 2) continue;
    const free = own.filter((sub) => !takenKeys.has(sub.key));
    for (const s of suggestLinks(
      linked.map((r) => ({
        id: r.id,
        orgName: r.orgName,
        accountName: r.accountName,
        balance: Number(r.lastBalance),
      })),
      free,
    )) {
      if (s.candidate.taxType === null) continue;
      const sub = s.candidate as (typeof free)[number];
      suggestions.set(s.simplefinAccountId, {
        performanceAccountId,
        subKey: sub.key,
        label: `${perfLabel.get(performanceAccountId) ?? ""} — ${sub.label}`,
      });
    }
  }
  return { subByKey, suggestions };
}

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
      const { accounts, providerErrors } = await getAccounts(accessUrl);
      await upsertSimplefinAccounts(ctx.db, accounts);
      return {
        success: true as const,
        accountCount: accounts.length,
        providerErrors,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return { success: false as const, error: msg.slice(0, 200) };
    }
  }),

  /** Manual sync trigger — calls the same runSimplefinSync the daily cron calls. At most once per 10 minutes (quota). */
  syncNow: syncProcedure.mutation(async ({ ctx }) => {
    if (!isSimplefinReplayMode()) {
      const last = await lastSimplefinRequestAt(ctx.db);
      if (
        last &&
        Date.now() - last.getTime() < SIMPLEFIN_MANUAL_SYNC_MIN_GAP_MS
      ) {
        const minutes = Math.ceil(
          (SIMPLEFIN_MANUAL_SYNC_MIN_GAP_MS - (Date.now() - last.getTime())) /
            60_000,
        );
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `SimpleFIN was synced moments ago. Try again in ${minutes} minute${minutes === 1 ? "" : "s"} — SimpleFIN allows only about 24 requests a day.`,
        });
      }
    }
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

  /** Connection status for the Settings integrations card and the sidebar's Data Updated tooltip. */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const conn = await getSimplefinConnection(ctx.db);
    if (!conn) {
      return { connected: false as const, lastSyncedAt: null, lastError: null };
    }
    return {
      connected: true as const,
      lastSyncedAt: conn.lastSyncedAt,
      lastError: await getSimplefinLastError(ctx.db),
    };
  }),

  /** What the sync has collected and how much of today's request quota is used — counts only, for Settings → Data sources. */
  getCollectionStats: protectedProcedure.query(async ({ ctx }) => {
    const h = schema.holdingObservations;
    const t = schema.investmentTransactions;
    const [holdingRows, txStats, requestsLastDay, balanceRows] =
      await Promise.all([
        ctx.db
          .select({
            accountId: h.simplefinAccountId,
            securityId: h.securityId,
            asOf: h.asOf,
            shares: h.shares,
          })
          .from(h)
          .where(isNotNull(h.simplefinAccountId)),
        ctx.db
          .select({
            count: sql<number>`count(*)`,
            accounts: sql<number>`count(distinct ${t.simplefinAccountId})`,
            oldest: sql<string | null>`min(${t.posted})`,
          })
          .from(t)
          .where(isNull(t.voidedAt)),
        countSimplefinRequestsLastDay(ctx.db),
        ctx.db
          .select({
            orgName: schema.simplefinAccounts.orgName,
            lastBalanceDate: schema.simplefinAccounts.lastBalanceDate,
            lastSeenAt: schema.simplefinAccounts.lastSeenAt,
          })
          .from(schema.simplefinAccounts)
          .where(eq(schema.simplefinAccounts.isIncluded, true)),
      ]);
    // Same summary as the Live Balance card, so both say the same "as of".
    const balanceDates = summarizeBalanceDates(
      balanceRows.map((r) => ({
        institution: r.orgName,
        reportedAt: r.lastBalanceDate ?? r.lastSeenAt,
      })),
    );
    // Latest row per (account, fund); a fund whose latest row is 0 shares was sold.
    const latest = new Map<string, { asOf: string; shares: number }>();
    for (const r of holdingRows) {
      const key = `${r.accountId}:${r.securityId}`;
      const prev = latest.get(key);
      if (!prev || r.asOf > prev.asOf)
        latest.set(key, { asOf: r.asOf, shares: Number(r.shares) });
    }
    const held = [...latest.values()].filter((v) => v.shares !== 0);
    return {
      holdings: held.length,
      holdingsAsOf: held.reduce<string | null>(
        (max, v) => (max === null || v.asOf > max ? v.asOf : max),
        null,
      ),
      transactions: Number(txStats[0]?.count ?? 0),
      transactionAccounts: Number(txStats[0]?.accounts ?? 0),
      oldestTransaction: txStats[0]?.oldest ?? null,
      requestsLastDay,
      dailyRequestLimit: SIMPLEFIN_DAILY_REQUEST_LIMIT,
      /** Least current first; `asOf` is a valuation date (YYYY-MM-DD). */
      dataAsOf: balanceDates.institutions,
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
    const links = await linkContext(ctx.db, rows);

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
        snapshotBalanceByPerfId.get(r.linkedPerformanceAccountId) ?? null;
      const linkedTotal =
        linkedTotalByPerfId.get(r.linkedPerformanceAccountId) ?? lastBalance;
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

  /** Active performance_accounts, for the match-to-existing-account picker. */
  listMatchableAccounts: protectedProcedure.query(async ({ ctx }) => {
    const [accounts, people, subs] = await Promise.all([
      ctx.db
        .select()
        .from(schema.performanceAccounts)
        .where(eq(schema.performanceAccounts.isActive, true))
        .orderBy(
          asc(schema.performanceAccounts.displayOrder),
          asc(schema.performanceAccounts.id),
        ),
      ctx.db.select().from(schema.people),
      loadLatestSubAccounts(ctx.db),
    ]);
    const peopleMap = new Map(people.map((p) => [p.id, p.name]));
    return accounts.map((a) => ({
      id: a.id,
      label: accountDisplayName(
        a,
        a.ownerPersonId != null ? peopleMap.get(a.ownerPersonId) : undefined,
      ),
      // Only worth choosing between when the account has more than one.
      subAccounts: subs
        .filter((sub) => sub.performanceAccountId === a.id)
        .map((sub) => ({ key: sub.key, label: sub.label })),
    }));
  }),

  /**
   * Link every unlinked SimpleFIN account to its suggested (sub-)account, and
   * narrow whole-account links to their suggested sub-account.
   */
  acceptLinkSuggestions: syncProcedure
    .input(z.object({ ids: z.array(z.number().int()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db.select().from(schema.simplefinAccounts);
      const { suggestions } = await linkContext(ctx.db, rows);
      let linked = 0;
      for (const [id, s] of suggestions) {
        if (input.ids && !input.ids.includes(id)) continue;
        await ctx.db
          .update(schema.simplefinAccounts)
          .set({
            linkedPerformanceAccountId: s.performanceAccountId,
            linkedSubKey: s.subKey,
          })
          .where(
            and(
              eq(schema.simplefinAccounts.id, id),
              // Unlinked, or linked to this whole account (a narrower link).
              or(
                isNull(schema.simplefinAccounts.linkedPerformanceAccountId),
                and(
                  eq(
                    schema.simplefinAccounts.linkedPerformanceAccountId,
                    s.performanceAccountId,
                  ),
                  isNull(schema.simplefinAccounts.linkedSubKey),
                ),
              ),
            ),
          );
        await redactStoredCardSpending(ctx.db, id);
        linked++;
      }
      return { linked };
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
        /** A sub-account of that tracked account (snapshotAccountKey), or null/absent for the whole account. */
        subKey: z.string().max(200).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subKey =
        input.performanceAccountId == null ? null : (input.subKey ?? null);
      if (subKey) {
        const subs = await loadLatestSubAccounts(ctx.db);
        if (
          !subs.some(
            (sub) =>
              sub.key === subKey &&
              sub.performanceAccountId === input.performanceAccountId,
          )
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That sub-account isn't in the latest snapshot",
          });
      }
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
        .set({
          linkedPerformanceAccountId: input.performanceAccountId,
          linkedSubKey: subKey,
        })
        .where(eq(schema.simplefinAccounts.id, input.id))
        .returning();

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SimpleFIN account not found",
        });
      }

      // Relinking to an HSA (or unlinking) redacts card spending kept while
      // the account was linked elsewhere — same rule as ingest.
      await redactStoredCardSpending(ctx.db, row.id);

      return {
        success: true as const,
        linkedPerformanceAccountId: row.linkedPerformanceAccountId,
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
});
