/**
 * Stress test endpoint: the deterministic projection at the conservative, baseline
 * and optimistic parameter sets, for the PlanHealthCard stress-test panel.
 */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import {
  prepareEngineInput,
  prepareProjectionRun,
} from "@/server/services/projection/projection-run";
import { runStressTestScenarios } from "@/lib/pure/simulation/stress-test-run";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

export const stressTestRouter = createTRPCRouter({
  /**
   * Runs the projection once per stress scenario (each overrides return, inflation,
   * salary-growth and withdrawal rates) and returns summary metrics per scenario.
   */
  computeStressTest: protectedProcedure
    .input(
      z
        .strictObject({
          selection: profileSelectionSchema.optional(),
          snapshotId: z.number().int().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const { payload } = await prepareProjectionRun(ctx, {
        selection: input?.selection,
        snapshotId: input?.snapshotId,
      });
      if (!payload) return { scenarios: [], retirementAge: null };

      const { baseEngineInput, planRetirementAge } = payload;

      // The shared builder resolves the household's real routing, RMD/QCD and
      // strategy settings; each stress scenario overrides only `withdrawalRate`.
      const {
        decumulationDefaults,
        accumulationOverrides,
        decumulationOverrides,
      } = await prepareEngineInput(ctx.db, payload, {
        decumulationDefaults: { withdrawalTaxPreference: {} },
      });
      const scenarios = runStressTestScenarios({
        baseEngineInput,
        decumulationDefaults,
        // The household's saved "Changes by year" (D6).
        accumulationOverrides,
        decumulationOverrides,
      });

      return {
        scenarios,
        retirementAge: planRetirementAge,
      };
    }),
});
