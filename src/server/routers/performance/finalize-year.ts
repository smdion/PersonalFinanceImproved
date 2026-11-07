import { z } from "zod/v4";
import { performanceProcedure } from "../../trpc";
import { PERF_CATEGORY_DISPLAY_ORDER } from "@/lib/config/display-labels";
import { finalizePerformanceYear } from "@/server/services/performance/finalize-year";

export const finalizeYearProcedures = {
  /**
   * Finalize a year: marks all account_performance and annual_performance rows
   * for that year as finalized, then auto-creates next year's rows for active accounts.
   */
  finalizeYear: performanceProcedure
    .input(
      z.object({
        year: z.number().int(),
        overrides: z
          .array(
            z.object({
              category: z.enum(PERF_CATEGORY_DISPLAY_ORDER),
              beginningBalance: z.string(),
              totalContributions: z.string(),
              yearlyGainLoss: z.string(),
              endingBalance: z.string(),
              employerContributions: z.string(),
              distributions: z.string(),
              fees: z.string(),
              rollovers: z.string().default("0"),
              lifetimeGains: z.string(),
              lifetimeContributions: z.string(),
              lifetimeMatch: z.string(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) => finalizePerformanceYear(ctx, input)),
};
