/**
 * What SimpleFIN knows about each tracked account, for the Portfolio
 * page's account cards (portfolioProcedure — holdings and deposits are
 * transaction-level detail): live balance and link status, what it holds,
 * and whether deposits match the paycheck setup.
 */
import { changeSinceSnapshot } from "@/lib/pure/accounts/current-balances";
import { loadCurrentBalances } from "@/server/services/investments/current-balances";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { addDays, utcDayOf } from "@/lib/utils/date";
import { accountInsight } from "@/lib/pure/investments/account-insights";
import { tracksCostBasis } from "@/lib/config/account-types";
import {
  dailyEstimates,
  liveCoversAccount,
  RECENT_ACTIVITY_DAYS,
  sentTransactions,
} from "@/lib/pure/sync/simplefin-feeds";
import { getTransactionCoverageStart } from "@/lib/simplefin/sync";
import { loadContributionMix } from "@/server/services/contributions/contribution-mix";
import { toNumber } from "@/lib/utils/numbers";
import {
  loadAccounts,
  loadClassifiedTransactions,
  loadFeedContext,
  loadLatestHoldings,
  loadBalanceHistory,
} from "@/server/data/investments";
import { valueHoldings } from "@/server/services/investments/holdings-overview";

export const investmentAccountInsightsRouter = createTRPCRouter({
  getAccountInsights: portfolioProcedure.query(async ({ ctx }) => {
    const today = utcDayOf(ctx.scope.asOf);
    const since = addDays(today, -RECENT_ACTIVITY_DAYS);
    const [context, accounts, mix, holdings, coverage, perfRows] =
      await Promise.all([
        loadFeedContext(ctx.db),
        loadAccounts(ctx.db),
        loadContributionMix(ctx.db),
        loadLatestHoldings(ctx.db),
        getTransactionCoverageStart(ctx.db),
        ctx.db
          .select({
            id: schema.performanceAccounts.id,
            accountType: schema.performanceAccounts.accountType,
            costBasis: schema.performanceAccounts.costBasis,
          })
          .from(schema.performanceAccounts),
      ]);
    const { feeds, subs, snapshotDate, lastTransactionDay, unplaced } = context;
    // Since the snapshot needs transactions back to it, not just the window.
    const loadFrom =
      snapshotDate !== null && snapshotDate < since ? snapshotDate : since;
    const [rows, valued, current] = await Promise.all([
      loadClassifiedTransactions(ctx.db, { since: loadFrom }),
      valueHoldings(ctx.db, holdings),
      loadCurrentBalances(ctx.db),
    ]);
    const behindFeeds = new Set(
      current.feeds.filter((f) => f.behindSnapshot).map((f) => f.id),
    );
    const perfById = new Map(perfRows.map((p) => [p.id, p]));
    const perfIds = new Set([
      ...feeds.map((f) => f.performanceAccountId),
      ...mix.keys(),
    ]);

    return [...perfIds].map((performanceAccountId) => {
      const mine = feeds.filter(
        (f) => f.performanceAccountId === performanceAccountId,
      );
      const ids = new Set(mine.map((f) => f.id));
      const m = mix.get(performanceAccountId);
      const perf = perfById.get(performanceAccountId);
      return accountInsight({
        performanceAccountId,
        feeds: mine.map((f) => ({
          ...f,
          name: accounts.get(f.id)?.feedName ?? "",
        })),
        parts: subs.filter(
          (s) => s.performanceAccountId === performanceAccountId,
        ),
        unplaced: unplaced.filter(
          (u) => u.performanceAccountId === performanceAccountId,
        ),
        snapshotDate,
        behindSnapshot: [...ids].some((id) => behindFeeds.has(id)),
        snapshotCovered:
          snapshotDate !== null &&
          coverage !== null &&
          utcDayOf(coverage) <= snapshotDate,
        depositsSince: since,
        sendsTransactions: sentTransactions(
          [...ids],
          lastTransactionDay,
          since,
        ),
        transactions: rows.filter((r) => ids.has(r.simplefinAccountId)),
        holdings: valued.filter((h) => ids.has(h.simplefinAccountId)),
        costHoldings: holdings.filter((h) => ids.has(h.simplefinAccountId)),
        expectedYearly: m
          ? m.employeePreTax + m.employeeRoth + m.employeeOther + m.employer
          : null,
        storedCostBasis:
          perf && tracksCostBasis(perf.accountType)
            ? toNumber(perf.costBasis)
            : null,
      });
    });
  }),

  /**
   * How the household's linked accounts moved each day since the latest
   * snapshot, as a change from it — the Portfolio chart's live line and the
   * Net Worth page's "today" estimate add it to the snapshot's own total.
   * Only accounts whose live balance covers the whole account count.
   */
  getLiveSinceSnapshot: portfolioProcedure.query(async ({ ctx }) => {
    const { feeds, subs, snapshotDate, unplaced } = await loadFeedContext(
      ctx.db,
    );
    if (!snapshotDate || feeds.length === 0)
      return { snapshotDate, points: [], estimate: null };
    const [history, current] = await Promise.all([
      loadBalanceHistory(ctx.db),
      loadCurrentBalances(ctx.db),
    ]);
    // A feed behind the snapshot shows lag, not money that moved.
    const behind = new Set(
      current.feeds.filter((f) => f.behindSnapshot).map((f) => f.id),
    );
    const historyOf = (f: (typeof feeds)[number]) => {
      const rows: [string, number][] = (history.get(f.id) ?? []).map((h) => [
        h.day,
        h.balance,
      ]);
      if (f.balanceDay) rows.push([f.balanceDay, f.balance]);
      return rows.sort((a, b) => a[0].localeCompare(b[0]));
    };
    const accounts = [...new Set(feeds.map((f) => f.performanceAccountId))]
      .map((id) => {
        const mine = feeds.filter((f) => f.performanceAccountId === id);
        const parts = subs.filter((s) => s.performanceAccountId === id);
        if (mine.some((f) => behind.has(f.id))) return null;
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
    const today = utcDayOf(ctx.scope.asOf);
    for (let d = addDays(snapshotDate, 1); d <= today; d = addDays(d, 1))
      days.push(d);
    return {
      snapshotDate,
      points: dailyEstimates(days, 0, accounts)
        .filter((p) => p.accounts > 0)
        .map((p) => ({ date: p.date, change: p.total, accounts: p.accounts })),
      // Today's best figure: each account's newest balance, moved to the
      // latest close where its holdings are priced.
      estimate: {
        change: changeSinceSnapshot(current.balances),
        accounts: new Set(
          current.balances
            .filter((b) => !b.noSnapshot)
            .map((b) => b.performanceAccountId),
        ).size,
        estimatedTo: current.summary.estimatedTo,
        estimateIsPartial: current.summary.estimateIsPartial,
      },
    };
  }),
});
