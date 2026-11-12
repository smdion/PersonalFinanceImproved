import { protectedProcedure } from "../../trpc";
import {
  computeRelocationAnalysis,
  zRelocationAnalysisInput,
} from "@/server/services/projection/relocation-analysis";

export const relocationAnalysisProcedures = {
  /**
   * The Relocation tool: the current and the relocation budget and contribution choices compared,
   * with expenses, savings rate, FI target and age, and the earliest safe move age.
   */
  computeRelocationAnalysis: protectedProcedure
    .input(zRelocationAnalysisInput)
    .query(({ ctx, input }) => computeRelocationAnalysis(ctx, input)),
};
