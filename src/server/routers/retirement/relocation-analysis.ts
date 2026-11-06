import { protectedProcedure } from "../../trpc";
import {
  computeRelocationAnalysis,
  zRelocationAnalysisInput,
} from "@/server/services/projection/relocation-analysis";

export const relocationAnalysisProcedures = {
  computeRelocationAnalysis: protectedProcedure
    .input(zRelocationAnalysisInput)
    .query(({ ctx, input }) => computeRelocationAnalysis(ctx, input)),
};
