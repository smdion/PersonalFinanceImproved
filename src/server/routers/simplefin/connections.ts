import { z } from "zod/v4";
import { and, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { adminProcedure, protectedProcedure, syncProcedure } from "../../trpc";
import {
  BudgetApiError,
  nothingChanged,
  userMessageFor,
} from "@/lib/budget-api/errors";
import { newestReportPerDay } from "@/lib/pure/sync/simplefin-holdings";
import { staleFeeds } from "@/lib/pure/sync/stale-feeds";
import * as schema from "@/lib/db/schema";
import {
  getSimplefinConnection,
  saveSimplefinConnection,
  removeSimplefinConnection,
  runSimplefinSync,
  upsertSimplefinAccounts,
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
  simplefinRequestRecorder,
  stopAtSimplefinQuota,
} from "@/lib/simplefin/request-log";
import { readMaybeEncrypted } from "@/lib/crypto";
import { summarizeBalanceDates } from "@/lib/pure/accounts/balance-dates";
import type { SimplefinConfig } from "@/lib/simplefin/sync";
import type { ProbeResult } from "@/lib/http/probe-result";
import { TRPCError } from "@trpc/server";

export const connectionsProcedures = {
  /** Claim a one-time setup token and store the resulting access URL. */
  saveToken: adminProcedure
    .input(z.object({ setupToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      let accessUrl: string;
      try {
        accessUrl = await claimSetupToken(input.setupToken);
      } catch (e) {
        // Nothing is stored until SimpleFIN hands over the access URL.
        const cause = e instanceof BudgetApiError ? nothingChanged(e) : e;
        const msg = e instanceof Error ? e.message : "Unknown error";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            userMessageFor(cause) ??
            `Failed to claim SimpleFIN setup token: ${msg.slice(0, 200)}`,
          cause,
        });
      }
      await saveSimplefinConnection(ctx.db, accessUrl);
      return { ok: true as const };
    }),

  /** Test the stored connection without writing a snapshot. */
  testConnection: adminProcedure.mutation(
    async ({
      ctx,
    }): Promise<
      ProbeResult<{
        accountCount: number;
        providerErrors: Awaited<
          ReturnType<typeof getAccounts>
        >["providerErrors"];
      }>
    > => {
      const conn = await getSimplefinConnection(ctx.db);
      if (!conn) {
        return {
          ok: false as const,
          error: "No SimpleFIN connection configured",
        };
      }
      try {
        const { accessUrl } = readMaybeEncrypted<SimplefinConfig>(conn.config);
        // A test counts against the daily quota like a sync.
        await stopAtSimplefinQuota(ctx.db);
        const { accounts, providerErrors } = await getAccounts(accessUrl, {
          onRequest: simplefinRequestRecorder(ctx.db),
        });
        await upsertSimplefinAccounts(ctx.db, accounts);
        return {
          ok: true as const,
          accountCount: accounts.length,
          providerErrors,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return {
          ok: false as const,
          error: userMessageFor(e) ?? msg.slice(0, 200),
        };
      }
    },
  ),

  /** Manual sync trigger — calls the same runSimplefinSync the daily cron calls. At most once per 10 minutes (quota). */
  syncNow: syncProcedure.mutation(async ({ ctx }) => {
    if (!isSimplefinReplayMode()) {
      const last = await lastSimplefinRequestAt(ctx.db);
      if (
        last &&
        Date.now() - last.getTime() < SIMPLEFIN_MANUAL_SYNC_MIN_GAP_MS
      ) {
        const since = Date.now() - last.getTime();
        const ago = Math.floor(since / 60_000);
        const minutes = Math.ceil(
          (SIMPLEFIN_MANUAL_SYNC_MIN_GAP_MS - since) / 60_000,
        );
        const plural = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;
        // The last request may have been a sync or a connection test.
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Ledgr sent SimpleFIN a request ${ago < 1 ? "less than a minute" : plural(ago)} ago. Try again in ${plural(minutes)} — SimpleFIN allows only about 24 requests a day.`,
        });
      }
    }
    try {
      return { ok: true as const, ...(await runSimplefinSync(ctx.db)) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `SimpleFIN sync failed: ${msg.slice(0, 200)}`,
        cause: e,
      });
    }
  }),

  /** Remove the stored connection (history in simplefin_balance_snapshots is preserved). */
  removeConnection: adminProcedure.mutation(async ({ ctx }) => {
    await removeSimplefinConnection(ctx.db);
    return { ok: true as const };
  }),

  /** Connection status for the Settings integrations card and the sidebar's Data Updated tooltip. */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const conn = await getSimplefinConnection(ctx.db);
    if (!conn) {
      return {
        connected: false as const,
        lastSyncedAt: null,
        lastError: null,
        staleFeeds: [],
      };
    }
    const [lastError, feeds] = await Promise.all([
      getSimplefinLastError(ctx.db),
      ctx.db
        .select({
          id: schema.simplefinAccounts.id,
          orgName: schema.simplefinAccounts.orgName,
          isIncluded: schema.simplefinAccounts.isIncluded,
          linkedLoanId: schema.simplefinAccounts.linkedLoanId,
          lastBalanceDate: schema.simplefinAccounts.lastBalanceDate,
          lastSeenAt: schema.simplefinAccounts.lastSeenAt,
        })
        .from(schema.simplefinAccounts),
    ]);
    return {
      connected: true as const,
      lastSyncedAt: conn.lastSyncedAt,
      lastError,
      /** Feeds still listed whose balance stopped moving. */
      staleFeeds: staleFeeds(feeds),
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
            simplefinAccountId: h.simplefinAccountId,
            securityId: h.securityId,
            asOf: h.asOf,
            balanceDate: h.balanceDate,
            shares: h.shares,
          })
          .from(h)
          .where(isNotNull(h.simplefinAccountId))
          .then(newestReportPerDay),
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
          .where(
            and(
              eq(schema.simplefinAccounts.isIncluded, true),
              isNull(schema.simplefinAccounts.linkedLoanId),
              or(
                isNotNull(schema.simplefinAccounts.linkedPerformanceAccountId),
                gte(schema.simplefinAccounts.lastBalance, "0"),
              ),
            ),
          ),
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
      const key = `${r.simplefinAccountId}:${r.securityId}`;
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
};
