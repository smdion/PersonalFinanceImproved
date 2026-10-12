/**
 * What SimpleFIN knows about each tracked account, for the Portfolio
 * page's account cards (portfolioProcedure — holdings and deposits are
 * transaction-level detail): live balance and link status, what it holds,
 * and whether deposits match the paycheck setup.
 */
import { asc, desc, gte, inArray } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { utcDayOf } from "@/lib/simplefin/ingest";
import { roundToCents } from "@/lib/utils/math";
import { blendedCost, portfolioBuckets } from "@/lib/pure/fund-facts";
import { checkDeposits } from "@/lib/pure/deposit-check";
import { suggestCostBasis } from "@/lib/pure/cost-basis";
import { tracksCostBasis } from "@/lib/config/account-types";
import { accountFlowsSince } from "@/lib/pure/snapshot-flows";
import { dailyEstimates, liveCoversAccount } from "@/lib/pure/simplefin-feeds";
import { getTransactionCoverageStart } from "@/lib/simplefin/sync";
import { suggestSnapshotAmounts } from "@/lib/pure/snapshot-suggestions";
import { loadLatestSubAccounts } from "@/server/helpers/sub-accounts";
import { loadContributionMix } from "@/server/helpers/contribution-mix";
import { toNumber } from "@/server/helpers/transforms";
import {
  countedFeed,
  loadAccounts,
  loadClassifiedTransactions,
  loadLatestHoldings,
} from "./_shared";
import { valueHoldings } from "./fund-facts";

/** Days of deposits the check looks at (SimpleFIN keeps about 90). */
const WINDOW_DAYS = 90;

export const investmentAccountInsightsRouter = createTRPCRouter({
  getAccountInsights: portfolioProcedure.query(async ({ ctx }) => {
    const since = utcDayOf(new Date(Date.now() - WINDOW_DAYS * 86_400_000));
    const [
      feeds,
      subs,
      accounts,
      mix,
      recent,
      holdings,
      latestSnapshot,
      coverage,
    ] = await Promise.all([
      ctx.db
        .select({
          id: schema.simplefinAccounts.id,
          performanceAccountId:
            schema.simplefinAccounts.linkedPerformanceAccountId,
          subKey: schema.simplefinAccounts.linkedSubKey,
          balance: schema.simplefinAccounts.lastBalance,
          balanceDate: schema.simplefinAccounts.lastBalanceDate,
        })
        .from(schema.simplefinAccounts)
        .where(countedFeed),
      loadLatestSubAccounts(ctx.db),
      loadAccounts(ctx.db),
      loadContributionMix(ctx.db),
      ctx.db
        .selectDistinct({
          id: schema.investmentTransactions.simplefinAccountId,
        })
        .from(schema.investmentTransactions)
        .where(gte(schema.investmentTransactions.posted, since)),
      loadLatestHoldings(ctx.db),
      ctx.db
        .select({ date: schema.portfolioSnapshots.snapshotDate })
        .from(schema.portfolioSnapshots)
        .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
        .limit(1),
      getTransactionCoverageStart(ctx.db),
    ]);
    const perfRows = await ctx.db
      .select({
        id: schema.performanceAccounts.id,
        accountType: schema.performanceAccounts.accountType,
        costBasis: schema.performanceAccounts.costBasis,
      })
      .from(schema.performanceAccounts);
    const perfById = new Map(perfRows.map((p) => [p.id, p]));
    const snapshotDate = latestSnapshot[0]?.date ?? null;
    // Since the snapshot needs transactions back to it, not just 90 days.
    const loadFrom =
      snapshotDate !== null && snapshotDate < since ? snapshotDate : since;
    const snapshotCovered =
      snapshotDate !== null &&
      coverage !== null &&
      utcDayOf(coverage) <= snapshotDate;
    const [rows, valued] = await Promise.all([
      loadClassifiedTransactions(ctx.db, { since: loadFrom }),
      valueHoldings(ctx.db, holdings),
    ]);
    const sending = new Set(recent.map((r) => r.id));
    const { unplaced } = suggestSnapshotAmounts(
      subs.map((s) => ({
        key: s.key,
        performanceAccountId: s.performanceAccountId,
        taxType: s.taxType,
        subType: s.subType,
        amount: s.amount,
      })),
      feeds.map((f) => ({
        id: f.id,
        performanceAccountId: f.performanceAccountId!,
        subKey: f.subKey,
        balance: toNumber(f.balance),
        balanceDate: null,
      })),
    );
    const subByKey = new Map(subs.map((s) => [s.key, s]));
    const perfIds = new Set([
      ...feeds.map((f) => f.performanceAccountId!),
      ...mix.keys(),
    ]);

    return [...perfIds].map((performanceAccountId) => {
      const mine = feeds.filter(
        (f) => f.performanceAccountId === performanceAccountId,
      );
      const ids = new Set(mine.map((f) => f.id));
      const accountSubs = subs.filter(
        (s) => s.performanceAccountId === performanceAccountId,
      );
      const whole = mine.some((f) => !f.subKey);
      const sendsTransactions = mine.some((f) => sending.has(f.id));
      const status =
        mine.length === 0
          ? ("none" as const)
          : sendsTransactions
            ? ("linked" as const)
            : ("balance_only" as const);
      const dates = mine
        .map((f) => (f.balanceDate ? utcDayOf(f.balanceDate) : null))
        .filter((d): d is string => d !== null)
        .sort();
      const accountHoldings = valued.filter((h) =>
        ids.has(h.simplefinAccountId),
      );
      const m = mix.get(performanceAccountId);
      const expected = m
        ? m.employeePreTax + m.employeeRoth + m.employeeOther + m.employer
        : null;
      const deposits = rows.filter(
        (r) =>
          ids.has(r.simplefinAccountId) &&
          r.posted >= since &&
          r.kind === "contribution" &&
          !r.pending &&
          !r.voided,
      );
      const liveTotal = roundToCents(
        mine.reduce((t, f) => t + toNumber(f.balance), 0),
      );
      const snapshotTotal = roundToCents(
        accountSubs.reduce((t, s) => t + s.amount, 0),
      );
      const accountUnplaced = unplaced.filter(
        (u) => u.performanceAccountId === performanceAccountId,
      );
      // Only when the live balance covers the whole account as the
      // snapshot does (every part linked, nothing outside a part).
      const comparable =
        snapshotDate !== null &&
        liveCoversAccount(
          accountSubs.map((s) => s.key),
          mine.map((f) => f.subKey),
          accountUnplaced.length,
        );
      const sinceSnapshot = comparable
        ? {
            snapshotDate: snapshotDate!,
            change: roundToCents(liveTotal - snapshotTotal),
            covered: snapshotCovered,
            ...accountFlowsSince(
              rows.filter((r) => ids.has(r.simplefinAccountId) && !r.voided),
              snapshotDate!,
              liveTotal - snapshotTotal,
            ),
          }
        : null;
      const { buckets, unknown, total } = portfolioBuckets(accountHoldings);
      const perf = perfById.get(performanceAccountId);
      const costBasis =
        perf && tracksCostBasis(perf.accountType)
          ? (() => {
              const s = suggestCostBasis(
                holdings.filter((h) => ids.has(h.simplefinAccountId)),
              );
              return s
                ? {
                    stored: toNumber(perf.costBasis),
                    ...s,
                    asOf: holdings.find((h) => ids.has(h.simplefinAccountId))
                      ?.asOf,
                  }
                : null;
            })()
          : null;
      return {
        performanceAccountId,
        status,
        live:
          mine.length === 0
            ? null
            : {
                total: roundToCents(
                  mine.reduce((t, f) => t + toNumber(f.balance), 0),
                ),
                asOf: dates[0] ?? null,
              },
        feeds: mine.map((f) => {
          const a = accounts.get(f.id);
          return {
            id: f.id,
            name: `${a?.institution ?? ""} ${a?.accountName ?? ""}`.trim(),
            part: f.subKey ? (subByKey.get(f.subKey)?.label ?? null) : null,
          };
        }),
        /** Parts of the account no feed covers (only without a whole-account link). */
        unlinkedParts:
          whole || mine.length === 0
            ? []
            : accountSubs
                .filter((s) => !mine.some((f) => f.subKey === s.key))
                .map((s) => s.label),
        /** Change since the latest snapshot, split added / moved / markets (null when not comparable). */
        sinceSnapshot,
        /** Feeds whose money no part of the latest snapshot holds. */
        unplaced: accountUnplaced.map((u) => {
          const a = accounts.get(u.feedId);
          return {
            name: `${a?.institution ?? ""} ${a?.accountName ?? ""}`.trim(),
            balance: u.balance,
            reason: u.reason,
          };
        }),
        mix: { buckets, unknown, total },
        /** Taxable accounts: stored cost basis and the one holdings suggest. */
        costBasis,
        cost: blendedCost(accountHoldings),
        deposits: checkDeposits(
          deposits.map((d) => ({ posted: d.posted, amount: d.amount })),
          expected,
          sendsTransactions,
        ),
      };
    });
  }),

  /**
   * How the household's linked accounts moved each day since the latest
   * snapshot, as a change from it — the Portfolio chart's live line and the
   * Net Worth page's "today" estimate add it to the snapshot's own total.
   * Only accounts whose live balance covers the whole account count.
   */
  getLiveSinceSnapshot: portfolioProcedure.query(async ({ ctx }) => {
    const [feeds, subs, latest] = await Promise.all([
      ctx.db
        .select({
          id: schema.simplefinAccounts.id,
          performanceAccountId:
            schema.simplefinAccounts.linkedPerformanceAccountId,
          subKey: schema.simplefinAccounts.linkedSubKey,
          balance: schema.simplefinAccounts.lastBalance,
          balanceDate: schema.simplefinAccounts.lastBalanceDate,
        })
        .from(schema.simplefinAccounts)
        .where(countedFeed),
      loadLatestSubAccounts(ctx.db),
      ctx.db
        .select({ date: schema.portfolioSnapshots.snapshotDate })
        .from(schema.portfolioSnapshots)
        .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
        .limit(1),
    ]);
    const snapshotDate = latest[0]?.date ?? null;
    if (!snapshotDate || feeds.length === 0)
      return { snapshotDate, points: [] };
    const { unplaced } = suggestSnapshotAmounts(
      subs.map((s) => ({
        key: s.key,
        performanceAccountId: s.performanceAccountId,
        taxType: s.taxType,
        subType: s.subType,
        amount: s.amount,
      })),
      feeds.map((f) => ({
        id: f.id,
        performanceAccountId: f.performanceAccountId!,
        subKey: f.subKey,
        balance: toNumber(f.balance),
        balanceDate: null,
      })),
    );
    const history = await ctx.db
      .select({
        id: schema.simplefinAccountBalances.simplefinAccountId,
        date: schema.simplefinAccountBalances.balanceDate,
        balance: schema.simplefinAccountBalances.balance,
      })
      .from(schema.simplefinAccountBalances)
      .where(
        inArray(
          schema.simplefinAccountBalances.simplefinAccountId,
          feeds.map((f) => f.id),
        ),
      )
      .orderBy(asc(schema.simplefinAccountBalances.balanceDate));
    const historyOf = (f: (typeof feeds)[number]) => {
      const rows: [string, number][] = history
        .filter((h) => h.id === f.id)
        .map((h) => [utcDayOf(h.date), toNumber(h.balance)]);
      if (f.balanceDate)
        rows.push([utcDayOf(f.balanceDate), toNumber(f.balance)]);
      return rows.sort((a, b) => a[0].localeCompare(b[0]));
    };
    const accounts = [...new Set(feeds.map((f) => f.performanceAccountId!))]
      .map((id) => {
        const mine = feeds.filter((f) => f.performanceAccountId === id);
        const parts = subs.filter((s) => s.performanceAccountId === id);
        if (
          !liveCoversAccount(
            parts.map((p) => p.key),
            mine.map((f) => f.subKey),
            unplaced.filter((u) => u.performanceAccountId === id).length,
          )
        )
          return null;
        return {
          snapshotAmount: parts.reduce((t, p) => t + p.amount, 0),
          feedHistories: mine.map(historyOf),
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
    const days: string[] = [];
    const today = utcDayOf(new Date());
    for (let d = new Date(`${snapshotDate}T00:00:00Z`); utcDayOf(d) < today;) {
      d.setUTCDate(d.getUTCDate() + 1);
      days.push(utcDayOf(d));
    }
    return {
      snapshotDate,
      points: dailyEstimates(days, 0, accounts)
        .filter((p) => p.accounts > 0)
        .map((p) => ({ date: p.date, change: p.total, accounts: p.accounts })),
    };
  }),
});
