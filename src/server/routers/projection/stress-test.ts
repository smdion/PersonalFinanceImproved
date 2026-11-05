/**
 * Stress test endpoint.
 *
 * Re-runs the deterministic projection three times — once each at the
 * conservative, baseline, and optimistic stress-test parameter sets defined
 * in `src/lib/pure/simulation/stress-test.ts`. Used by the PlanHealthCard stress-test
 * panel to render side-by-side outcomes.
 */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import { runStressTestScenarios } from "../projection-v5-helpers";
import {
  buildDecumulationDefaults,
  resolveProjectionOverrides,
} from "./_shared";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { engineProfileOptions } from "@/lib/pure/household/profile-selection";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

export const stressTestRouter = createTRPCRouter({
  /**
   * Stress test.
   *
   * Re-runs the deterministic projection three times — once each at the
   * conservative, baseline, and optimistic stress test parameter sets
   * defined in src/lib/pure/simulation/stress-test.ts. Each scenario overrides
   * returnRates / inflationRate / salaryGrowthRate / withdrawalRate
   * before calling calculateProjection. Returns summary metrics
   * (nest egg at retirement, sustainable withdrawal, depletion age) so
   * the PlanHealthCard's stress test panel can render side-by-side
   * outcomes instead of just side-by-side parameters.
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
      const profiles = engineProfileOptions(input?.selection);
      const data = await fetchRetirementData(ctx.db, {
        snapshotId: input?.snapshotId,
        contributionProfileId: profiles.contributionProfileId,
        salaryProfileId: profiles.salaryProfileId,
      });
      const payload = await buildEnginePayload(ctx.db, data, {
        ...profiles,
      });
      if (!payload) return { scenarios: [], retirementAge: null };

      const {
        settings,
        distributionTaxRates,
        baseEngineInput,
        planRetirementAge,
      } = payload;

      // Resolved via the shared builder — the household's real routing
      // mode, order/splits, RMD/QCD handling, discretionary order, and
      // active strategy + params, same as every other consumer
      // (computeProjection, computeStrategyComparison, analyzeStrategy).
      // Each of the three stress scenarios then overrides only
      // `withdrawalRate`, its own controlled variable
      // (runStressTestScenarios, projection-v5-helpers.ts). Previously this
      // hand-built the object inline and silently dropped rmdExcessHandling/
      // qcdMaximize/rmdSmoothingEnabled/discretionaryWithdrawalOrder to
      // engine defaults regardless of what was configured.
      const decumulationDefaults = buildDecumulationDefaults(
        settings,
        { withdrawalTaxPreference: {} },
        distributionTaxRates,
      );
      const scenarios = runStressTestScenarios({
        baseEngineInput,
        decumulationDefaults,
        // The household's saved "Changes by year" (D6).
        ...((await resolveProjectionOverrides(ctx.db, {})) as {
          accumulationOverrides: ProjectionInput["accumulationOverrides"];
          decumulationOverrides: ProjectionInput["decumulationOverrides"];
        }),
      });

      return {
        scenarios,
        retirementAge: planRetirementAge,
      };
    }),
});
