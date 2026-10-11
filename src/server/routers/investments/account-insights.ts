/**
 * What SimpleFIN knows about each tracked account, for the Portfolio
 * page's account cards (portfolioProcedure — holdings and deposits are
 * transaction-level detail): live balance and link status, what it holds,
 * and whether deposits match the paycheck setup.
 */
import { gte } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { utcDayOf } from "@/lib/simplefin/ingest";
import { roundToCents } from "@/lib/utils/math";
import { blendedCost, portfolioBuckets } from "@/lib/pure/fund-facts";
import { checkDeposits } from "@/lib/pure/deposit-check";
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
    const [feeds, subs, accounts, mix, recent, holdings] = await Promise.all([
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
    ]);
    const [rows, valued] = await Promise.all([
      loadClassifiedTransactions(ctx.db, { since }),
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
          r.kind === "contribution" &&
          !r.pending &&
          !r.voided,
      );
      const { buckets, unknown, total } = portfolioBuckets(accountHoldings);
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
        /** Feeds whose money no part of the latest snapshot holds. */
        unplaced: unplaced
          .filter((u) => u.performanceAccountId === performanceAccountId)
          .map((u) => {
            const a = accounts.get(u.feedId);
            return {
              name: `${a?.institution ?? ""} ${a?.accountName ?? ""}`.trim(),
              balance: u.balance,
              reason: u.reason,
            };
          }),
        mix: { buckets, unknown, total },
        cost: blendedCost(accountHoldings),
        deposits: checkDeposits(
          deposits.map((d) => ({ posted: d.posted, amount: d.amount })),
          expected,
          sendsTransactions,
        ),
      };
    });
  }),
});
