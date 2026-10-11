/** Holdings as last reported per account (portfolioProcedure — share counts and values). */
import { eq } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { loadAccounts } from "./_shared";

export const investmentHoldingsRouter = createTRPCRouter({
  /**
   * Each account's holdings on the latest date it reported them. A fund
   * sold since then is left out (its latest row is 0 shares).
   */
  listHoldings: portfolioProcedure.query(async ({ ctx }) => {
    const h = schema.holdingObservations;
    const s = schema.securities;
    const [rows, accounts] = await Promise.all([
      ctx.db
        .select({
          simplefinAccountId: h.simplefinAccountId,
          securityId: h.securityId,
          asOf: h.asOf,
          shares: h.shares,
          reportedMarketValue: h.reportedMarketValue,
          avgCostPerShare: h.avgCostPerShare,
          ticker: s.ticker,
          sourceSymbol: s.sourceSymbol,
          name: s.name,
          kind: s.kind,
        })
        .from(h)
        .innerJoin(s, eq(s.id, h.securityId)),
      loadAccounts(ctx.db),
    ]);
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (r.simplefinAccountId === null) continue; // manual rows come later
      const key = `${r.simplefinAccountId}:${r.securityId}`;
      const prev = latest.get(key);
      if (!prev || r.asOf > prev.asOf) latest.set(key, r);
    }
    return [...latest.values()]
      .filter((r) => Number(r.shares) !== 0)
      .map((r) => {
        const account = accounts.get(r.simplefinAccountId!);
        return {
          simplefinAccountId: r.simplefinAccountId!,
          institution: account?.institution ?? "",
          accountName: account?.accountName ?? "",
          asOf: r.asOf,
          ticker: r.ticker,
          symbol: r.ticker ?? r.sourceSymbol,
          name: r.name,
          kind: r.kind,
          shares: Number(r.shares),
          reportedMarketValue:
            r.reportedMarketValue === null
              ? null
              : Number(r.reportedMarketValue),
          avgCostPerShare:
            r.avgCostPerShare === null ? null : Number(r.avgCostPerShare),
        };
      })
      .sort(
        (a, b) =>
          a.institution.localeCompare(b.institution) ||
          a.accountName.localeCompare(b.accountName) ||
          (b.reportedMarketValue ?? 0) - (a.reportedMarketValue ?? 0),
      );
  }),
});
