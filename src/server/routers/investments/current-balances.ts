/** The Current Balances card's figures (load-current-balances.ts). */
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { loadCurrentBalances } from "./load-current-balances";

export const investmentCurrentBalancesRouter = createTRPCRouter({
  /** Totals, each account's figure, each feed's dates and daily moves —
   *  no holdings or transactions. */
  getCurrentBalances: protectedProcedure.query(async ({ ctx }) => {
    const r = await loadCurrentBalances(ctx.db);
    return {
      snapshotDate: r.snapshotDate,
      summary: r.summary,
      feeds: r.feeds,
      movement: r.movement,
      // Each account's (or part's) figure, as listAccounts already shows
      // every signed-in viewer — so rows can add up to the total.
      balances: r.balances.map((b) => ({
        key: b.key,
        feedIds: b.feedIds,
        performanceAccountId: b.performanceAccountId,
        current: b.current,
        snapshot: b.snapshot,
        comparable: b.comparable,
        noSnapshot: b.noSnapshot,
      })),
    };
  }),
});
