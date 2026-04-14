/**
 * Stress test endpoint (v0.5 expert-review M2).
 *
 * Re-runs the deterministic projection three times — once each at the
 * conservative, baseline, and optimistic stress-test parameter sets defined
 * in `src/lib/pure/stress-test.ts`. Used by the PlanHealthCard stress-test
 * panel to render side-by-side outcomes.
 *
 * Extracted from the old monolith `projection.ts` in PR 2b of the v0.5.2
 * file-split refactor. Pure relocation — no logic changes.
 */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import { runStressTestScenarios } from "../projection-v5-helpers";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { buildStrategyParams } from "./_shared";

export const stressTestRouter = createTRPCRouter({
  /**
   * Stress test (v0.5 expert-review M2).
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
          salaryOverrides: z
            .array(z.object({ personId: z.number(), salary: z.number() }))
            .optional(),
          contributionProfileId: z.number().int().optional(),
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
      });
      const payload = await buildEnginePayload(ctx.db, data, {
        salaryOverrides: input?.salaryOverrides,
        contributionProfileId: input?.contributionProfileId,
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

      const userStrategyParams = buildStrategyParams(settings);
      const activeStrategy =
        (settings.withdrawalStrategy as WithdrawalStrategyType) ?? "fixed";
      const scenarios = runStressTestScenarios({
        baseEngineInput,
        userStrategyParams,
        activeStrategy,
        distributionTaxRates,
        avgRetirementAge,
      });

      return {
        scenarios,
        retirementAge: avgRetirementAge,
      };
    }),
});
