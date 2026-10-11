/** Holdings as last reported per account (portfolioProcedure — share counts and values). */
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import { loadAccounts, loadLatestHoldings } from "./_shared";

export const investmentHoldingsRouter = createTRPCRouter({
  /**
   * Each account's holdings on the latest date it reported them. A fund
   * sold since then is left out (its latest row is 0 shares).
   */
  listHoldings: portfolioProcedure.query(async ({ ctx }) => {
    const [rows, accounts] = await Promise.all([
      loadLatestHoldings(ctx.db),
      loadAccounts(ctx.db),
    ]);
    return rows
      .map((r) => {
        const account = accounts.get(r.simplefinAccountId);
        return {
          simplefinAccountId: r.simplefinAccountId,
          institution: account?.institution ?? "",
          accountName: account?.accountName ?? "",
          asOf: r.asOf,
          ticker: r.ticker,
          symbol: r.ticker ?? r.sourceSymbol,
          name: r.name,
          kind: r.kind,
          shares: r.shares,
          reportedMarketValue: r.reportedMarketValue,
          avgCostPerShare: r.avgCostPerShare,
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
