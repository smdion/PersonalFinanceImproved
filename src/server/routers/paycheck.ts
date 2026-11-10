/** Paycheck router for gross-to-net pay calculations including federal tax withholding (no state tax), pre-tax deductions, and per-period contribution breakdowns. */
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  zPaycheckSummaryInput,
  computePaycheckSummary,
} from "@/server/services/paycheck/summary";

export const paycheckRouter = createTRPCRouter({
  /**
   * Each person's paycheck, gross to net, and the household's income and tax, under the active
   * Salary and Contribution profiles or the ones named, with the What-If tab's edits on top.
   */
  computeSummary: protectedProcedure
    .input(zPaycheckSummaryInput)
    .query(({ ctx, input }) => computePaycheckSummary(ctx, input)),
});
