/** The Current Balances card's figures (services/investments/current-balances.ts). */
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { loadCurrentBalances } from "@/server/services/investments/current-balances";
import { closeReports } from "@/lib/pure/net-worth/daily-movement";

export const investmentCurrentBalancesRouter = createTRPCRouter({
  /** Totals, each account's figure and move, each feed's dates and the
   *  daily moves — no holdings or transactions. */
  getCurrentBalances: protectedProcedure.query(async ({ ctx }) => {
    const r = await loadCurrentBalances(ctx.db);
    const moveOf = new Map(
      r.entryMoves.map((e) => [e.key, e.moves[0]?.move ?? null]),
    );
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
      })),
    };
  }),
});
