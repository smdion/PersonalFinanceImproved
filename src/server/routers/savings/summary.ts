import { z } from "zod/v4";
import { protectedProcedure } from "../../trpc";
import { computeSavingsSummary } from "@/server/services/savings/summary";

export const summaryProcedures = {
  /**
   * The Savings page: each fund with its resolved monthly funding and budget-API link, the
   * emergency fund, planned transactions with their settled months, and allocation overrides.
   */
  computeSummary: protectedProcedure
    .input(z.object({ budgetTierOverride: z.number().optional() }).optional())
    .query(({ ctx, input }) => computeSavingsSummary(ctx, input)),
};
