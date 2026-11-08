/** Contribution router for computing per-account contribution allocations, IRS limits, employer matches, and accumulation order across retirement and brokerage accounts. */
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { householdHighIncomeLine } from "@/server/services/paycheck/high-income-line";
import {
  zContributionSummaryInput,
  computeContributionSummary,
} from "@/server/services/contributions/summary";

export const contributionRouter = createTRPCRouter({
  /** The default high-income line — by this year's filing status (the
   *  saved setting, when set, wins on the client). Here so a filing-status
   *  save, which reloads `contribution`, reloads it too. */
  highIncomeLine: protectedProcedure.query(({ ctx }) =>
    householdHighIncomeLine(ctx.db, ctx.scope.asOf),
  ),
  computeSummary: protectedProcedure
    .input(zContributionSummaryInput)
    .query(({ ctx, input }) => computeContributionSummary(ctx, input)),
});
