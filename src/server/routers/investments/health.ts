/** Monitors for stored SimpleFIN investment data (portfolioProcedure — names accounts and compares values). */
import { isNotNull } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { investmentHealthIssues } from "@/lib/pure/investment-health";
import { localDateStr } from "@/lib/utils/date";
import { loadAccounts } from "./_shared";

export const investmentHealthRouter = createTRPCRouter({
  /** Accounts whose holdings stopped arriving or don't add up to the balance. */
  getHealth: portfolioProcedure.query(async ({ ctx }) => {
    const h = schema.holdingObservations;
    const [observations, balances, accounts] = await Promise.all([
      ctx.db
        .select({
          accountId: h.simplefinAccountId,
          asOf: h.asOf,
          balanceDate: h.balanceDate,
          shares: h.shares,
          value: h.reportedMarketValue,
        })
        .from(h)
        .where(isNotNull(h.simplefinAccountId)),
      ctx.db.select().from(schema.simplefinAccountBalances),
      loadAccounts(ctx.db),
    ]);

    // Each account's latest holdings day, the funds held that day, and the
    // balance SimpleFIN reported in the same response.
    const latestByAccount = new Map<number, typeof observations>();
    for (const o of observations) {
      const id = o.accountId!;
      const current = latestByAccount.get(id);
      if (!current || o.asOf > current[0]!.asOf) latestByAccount.set(id, [o]);
      else if (o.asOf === current[0]!.asOf) current.push(o);
    }
    const inputs = [...latestByAccount.entries()].map(([id, rows]) => {
      const held = rows.filter((r) => Number(r.shares) !== 0);
      const valued = held.every((r) => r.value !== null);
      const balanceDate = rows[0]!.balanceDate?.getTime();
      const balance = balances.find(
        (b) =>
          b.simplefinAccountId === id &&
          b.balanceDate.getTime() === balanceDate,
      );
      const account = accounts.get(id);
      return {
        label: account?.feedName ?? "",
        holdingsAsOf: rows[0]!.asOf,
        holdingsValue: valued
          ? held.reduce((sum, r) => sum + Number(r.value), 0)
          : null,
        balance: balance ? Number(balance.balance) : null,
      };
    });

    return { issues: investmentHealthIssues(inputs, localDateStr()) };
  }),
});
