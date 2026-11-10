/** Always Be Buying, month by month: whether SimpleFIN saw a deposit into
 *  a counted feed each whole month it covered (lib/pure/investments/always-buying.ts). */
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import { loadBuyingMonths } from "@/server/services/investments/buying-months";

export const investmentBuyingRouter = createTRPCRouter({
  /**
   * Always Be Buying: each whole month since the first transaction, invested, not invested
   * or unknown, from deposits into the counted SimpleFIN feeds.
   */
  computeBuyingMonths: portfolioProcedure.query(({ ctx }) =>
    loadBuyingMonths(ctx),
  ),
});
