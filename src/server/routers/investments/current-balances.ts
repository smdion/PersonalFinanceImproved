/** The Current Balances card's figures (services/investments/current-balances.ts). */
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { loadCurrentBalances } from "@/server/services/investments/current-balances";
import { closeReports } from "@/lib/pure/net-worth/daily-movement";
import { noHoldingsInto } from "@/lib/pure/accounts/current-balance-groups";

export const investmentCurrentBalancesRouter = createTRPCRouter({
  /** Totals, each account's figure and move, each feed's dates and the
   *  daily moves — no holdings or transactions. */
  getCurrentBalances: protectedProcedure.query(async ({ ctx }) => {
    const r = await loadCurrentBalances(ctx.db, ctx.scope.asOf);
    const moveOf = new Map(
      r.entryMoves.map((e) => [e.key, e.moves[0]?.move ?? null]),
    );
    const noHoldingsOf = noHoldingsInto(r.unpricedMoves, r.target);
    return {
      snapshotDate: r.snapshotDate,
      /** The close every figure is brought to. */
      target: r.target,
      summary: r.summary,
      feeds: r.feeds,
      /** Market move into each recent close, latest first. */
      movement: r.movement,
      /** Accounts missing a value at some of those closes, with where and
       *  their move over each run of closes they sent no report for. */
      closeReports: closeReports(
        r.entryMoves,
        r.movement.map((c) => c.day),
      ),
      /** Accounts whose feeds send no holdings, by the closes their
       *  balance changed into (market and deposits not split). */
      unpricedMoves: r.unpricedMoves,
      // Each account's (or part's) figure, as listAccounts already shows
      // every signed-in viewer — so rows can add up to the total.
      balances: r.balances.map((b) => ({
        key: b.key,
        feedIds: b.feedIds,
        performanceAccountId: b.performanceAccountId,
        current: b.current,
        snapshot: b.snapshot,
        noSnapshot: b.noSnapshot,
        /** The snapshot's figure, or an institution's newer report. */
        source: b.source,
        /** Holds funds that move with markets. */
        market: moveOf.has(b.key),
        /** Its move into the target close; null when it can't be told. */
        move: moveOf.get(b.key) ?? null,
        /** No holdings, and its balance changed into the target close. */
        noHoldings: noHoldingsOf.get(b.key) ?? null,
      })),
    };
  }),
});
