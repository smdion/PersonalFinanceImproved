/** The Current Balances card's figures (load-current-balances.ts). */
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { loadCurrentBalances } from "./load-current-balances";

export const investmentCurrentBalancesRouter = createTRPCRouter({
  /** Totals and each feed's dates — no holdings, transactions or
   *  per-account figures. */
  getCurrentBalances: protectedProcedure.query(async ({ ctx }) => {
    const { snapshotDate, summary, feeds } = await loadCurrentBalances(ctx.db);
    return { snapshotDate, summary, feeds };
  }),
});
