/** Contribution router for computing per-account contribution allocations, IRS limits, employer matches, and accumulation order across retirement and brokerage accounts. */
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { householdHighIncomeLine } from "@/server/services/paycheck/high-income-line";
import {
  zContributionSummaryInput,
  computeContributionSummary,
} from "@/server/services/contributions/summary";
import { contributionAccountsProcedures } from "./contribution/accounts";

export const contributionRouter = createTRPCRouter({
  ...contributionAccountsProcedures,
  /** The default high-income line — by this year's filing status (the
   *  saved setting, when set, wins on the client). Here so a filing-status
   *  save, which reloads `contribution`, reloads it too. */
  computeHighIncomeLine: protectedProcedure.query(({ ctx }) =>
    householdHighIncomeLine(ctx.db, ctx.scope.asOf),
  ),
  /**
   * Each person's contributions by account against this year's IRS limits, joint totals, and
   * the prior-year window while it is open; profiles and What-If edits as the paycheck summary.
   */
  computeSummary: protectedProcedure
    .input(zContributionSummaryInput)
    .query(({ ctx, input }) => computeContributionSummary(ctx, input)),
});
