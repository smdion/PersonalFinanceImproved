/**
 * Stress test endpoint.
 *
 * Re-runs the deterministic projection three times — once each at the
 * conservative, baseline, and optimistic stress-test parameter sets defined
 * in `src/lib/pure/stress-test.ts`. Used by the PlanHealthCard stress-test
 * panel to render side-by-side outcomes.
 */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import { runStressTestScenarios } from "../projection-v5-helpers";
import { buildDecumulationDefaults } from "./_shared";

export const stressTestRouter = createTRPCRouter({
  /**
   * Stress test.
   *
   * Re-runs the deterministic projection three times — once each at the
   * conservative, baseline, and optimistic stress test parameter sets
   * defined in src/lib/pure/stress-test.ts. Each scenario overrides
   * returnRates / inflationRate / salaryGrowthRate / withdrawalRate
   * before calling calculateProjection. Returns summary metrics
   * (nest egg at retirement, sustainable withdrawal, depletion age) so
   * the PlanHealthCard's stress test panel can render side-by-side
   * outcomes instead of just side-by-side parameters.
   */
  computeStressTest: protectedProcedure
    .input(
      z
        .object({
          salaryActiveFields: z
            .array(z.object({ personId: z.number(), salary: z.number() }))
            .optional(),
          contributionProfileId: z.number().int().optional(),
          /** Optional Salary Profile — the independent "what if I earned X" axis. */
          salaryProfileId: z.number().int().optional(),
          accumulationBudgetProfileId: z.number().int().optional(),
          accumulationBudgetColumn: z.number().int().min(0).optional(),
          accumulationExpenseOverride: z.number().min(0).optional(),
          decumulationBudgetProfileId: z.number().int().optional(),
          decumulationBudgetColumn: z.number().int().min(0).optional(),
          decumulationExpenseOverride: z.number().min(0).optional(),
          snapshotId: z.number().int().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const data = await fetchRetirementData(ctx.db, {
        snapshotId: input?.snapshotId,
        contributionProfileId: input?.contributionProfileId,
        salaryProfileId: input?.salaryProfileId,
      });
      const payload = await buildEnginePayload(ctx.db, data, {
        salaryActiveFields: input?.salaryActiveFields,
        contributionProfileId: input?.contributionProfileId,
        salaryProfileId: input?.salaryProfileId,
        accumulationBudgetProfileId: input?.accumulationBudgetProfileId,
        accumulationBudgetColumn: input?.accumulationBudgetColumn,
        accumulationExpenseOverride: input?.accumulationExpenseOverride,
        decumulationBudgetProfileId: input?.decumulationBudgetProfileId,
        decumulationBudgetColumn: input?.decumulationBudgetColumn,
        decumulationExpenseOverride: input?.decumulationExpenseOverride,
      });
      if (!payload) return { scenarios: [], retirementAge: null };

      const {
        settings,
        distributionTaxRates,
        baseEngineInput,
        avgRetirementAge,
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
        avgRetirementAge,
      });

      return {
        scenarios,
        retirementAge: avgRetirementAge,
      };
    }),
});
