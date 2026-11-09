/** Always Be Buying, month by month: whether SimpleFIN saw a deposit into
 *  a counted feed each whole month it covered (lib/pure/investments/always-buying.ts). */
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import { loadBuyingMonths } from "@/server/services/investments/buying-months";

export const investmentBuyingRouter = createTRPCRouter({
  computeBuyingMonths: portfolioProcedure.query(({ ctx }) =>
    loadBuyingMonths(ctx),
  ),
});
