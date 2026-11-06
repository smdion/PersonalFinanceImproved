/** Paycheck router for gross-to-net pay calculations including federal tax withholding (no state tax), pre-tax deductions, and per-period contribution breakdowns. */
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  zPaycheckSummaryInput,
  computePaycheckSummary,
} from "@/server/services/paycheck/summary";

export const paycheckRouter = createTRPCRouter({
  computeSummary: protectedProcedure
    .input(zPaycheckSummaryInput)
    .query(({ ctx, input }) => computePaycheckSummary(ctx, input)),
});
