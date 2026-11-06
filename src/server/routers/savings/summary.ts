import { z } from "zod/v4";
import { protectedProcedure } from "../../trpc";
import { computeSavingsSummary } from "@/server/services/savings/summary";

export const summaryProcedures = {
  computeSummary: protectedProcedure
    .input(z.object({ budgetTierOverride: z.number().optional() }).optional())
    .query(({ ctx, input }) => computeSavingsSummary(ctx, input)),
};
