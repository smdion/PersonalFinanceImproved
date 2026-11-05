/** Monitors for stored SimpleFIN investment data (portfolioProcedure — names accounts and compares values). */
import { isNotNull } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  holdingsGapSince,
  investmentHealthIssues,
} from "@/lib/pure/investments/investment-health";
import { newestReportPerDay } from "@/lib/pure/sync/simplefin-holdings";
import { loadAccounts } from "@/server/data/investments";

export const investmentHealthRouter = createTRPCRouter({
  /** Accounts whose holdings stopped arriving or don't add up to the balance. */
  getHealth: portfolioProcedure.query(async ({ ctx }) => {
    const h = schema.holdingObservations;
    const [observations, balances, accounts] = await Promise.all([
      ctx.db
        .select({
          simplefinAccountId: h.simplefinAccountId,
          asOf: h.asOf,
          balanceDate: h.balanceDate,
          shares: h.shares,
          value: h.reportedMarketValue,
        })
        .from(h)
        .where(isNotNull(h.simplefinAccountId))
        .then(newestReportPerDay),
      ctx.db.select().from(schema.simplefinAccountBalances),
      loadAccounts(ctx.db),
    ]);

    // Each account's reports: the funds held each day, and the balance
    // SimpleFIN sent in the same response.
    const byAccount = new Map<number, Map<string, typeof observations>>();
    for (const o of observations) {
      const id = o.simplefinAccountId!;
      const days = byAccount.get(id) ?? new Map<string, typeof observations>();
      days.set(o.asOf, [...(days.get(o.asOf) ?? []), o]);
      byAccount.set(id, days);
    }
    const inputs = [...byAccount.entries()].map(([id, days]) => {
      const reports = [...days.entries()].map(([asOf, rows]) => {
        const held = rows.filter((r) => Number(r.shares) !== 0);
        const balanceDate = rows[0]!.balanceDate?.getTime();
        const balance = balances.find(
          (b) =>
            b.simplefinAccountId === id &&
            b.balanceDate.getTime() === balanceDate,
        );
        return {
          asOf,
          holdingsValue: held.every((r) => r.value !== null)
            ? held.reduce((sum, r) => sum + Number(r.value), 0)
            : null,
          balance: balance ? Number(balance.balance) : null,
        };
      });
      const latest = reports.reduce((a, b) => (b.asOf > a.asOf ? b : a));
      return {
        label: accounts.get(id)?.feedName ?? "",
        holdingsAsOf: latest.asOf,
        holdingsValue: latest.holdingsValue,
        balance: latest.balance,
        gapSince: holdingsGapSince(reports),
      };
    });

    return { issues: investmentHealthIssues(inputs, ctx.scope.today) };
  }),
});
