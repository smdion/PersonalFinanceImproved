import { protectedProcedure } from "../../trpc";
import { computePerformanceSummary } from "@/server/services/performance/summary";

export const summaryProcedures = {
  /**
   * computeSummary — returns all performance data joined through the master performance_accounts table.
   * Includes: annual rollups, account-level detail, master account list, and current-year status.
   */
  computeSummary: protectedProcedure.query(({ ctx }) =>
    computePerformanceSummary(ctx),
  ),
};
