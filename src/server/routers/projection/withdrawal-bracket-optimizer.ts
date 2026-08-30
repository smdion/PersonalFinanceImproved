/**
 * Multi-year withdrawal-policy optimizer, Phase 3 — router endpoint.
 *
 * Modeled directly on `computeCoastFire` (`coast-fire.ts:90-112`): same
 * input shape (fetch household data via `fetchRetirementData`/
 * `buildEnginePayload`, same as every other scenario endpoint),
 * `protectedProcedure.query`, no `expensiveRateLimitMiddleware`, no
 * server-side projection cache — advisor round 1 confirmed this matches
 * Coast FIRE's own precedent for a synchronous, cheap, uncached search.
 * Split into its own file (not added to `coast-fire.ts`, already at 521
 * lines, over RULES.md §8's ~500-line Composed Router guideline).
 *
 * Client-side cache policy (staleTime/refetchOnMount) is a Phase 4
 * concern — standard tRPC query semantics already cache client-side by
 * default via TanStack Query; there is no server-side cache here to begin
 * with, so nothing here needs to decide that.
 */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { optimizeRothBracketTarget } from "@/lib/calculators/withdrawal-bracket-optimizer";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/calculators/types";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  decumulationDefaultsInputSchema,
  buildDecumulationDefaults,
} from "./_shared";

export const withdrawalBracketOptimizerRouter = createTRPCRouter({
  /**
   * Multi-year withdrawal-policy optimizer
   *
   * Searches the household's own real marginal bracket rates for the
   * `rothBracketTarget` that minimizes lifetime tax cost (plus a
   * terminal-value penalty for Traditional money left unconverted),
   * subject to still funding spending need through end of plan. See
   * `optimizeRothBracketTarget` for the full scoring/ranking algorithm.
   */
  computeWithdrawalBracketOptimizer: protectedProcedure
    .input(
      z.object({
        // Mirrors computeCoastFire's input subset that affects the engine.
        decumulationDefaults: decumulationDefaultsInputSchema,
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
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
      }),
    )
    .query(async ({ ctx, input }) => {
      const data = await fetchRetirementData(ctx.db, {
        snapshotId: input.snapshotId,
        contributionProfileId: input.contributionProfileId,
        salaryProfileId: input.salaryProfileId,
      });
      const payload = await buildEnginePayload(ctx.db, data, {
        salaryActiveFields: input.salaryActiveFields,
        contributionProfileId: input.contributionProfileId,
        salaryProfileId: input.salaryProfileId,
        accumulationBudgetProfileId: input.accumulationBudgetProfileId,
        accumulationBudgetColumn: input.accumulationBudgetColumn,
        accumulationExpenseOverride: input.accumulationExpenseOverride,
        decumulationBudgetProfileId: input.decumulationBudgetProfileId,
        decumulationBudgetColumn: input.decumulationBudgetColumn,
        decumulationExpenseOverride: input.decumulationExpenseOverride,
      });
      if (!payload) return { result: null };

      const { settings, distributionTaxRates, baseEngineInput } = payload;

      const engineInput = {
        ...baseEngineInput,
        decumulationDefaults: buildDecumulationDefaults(
          settings,
          input.decumulationDefaults,
          distributionTaxRates,
        ),
        accumulationOverrides:
          input.accumulationOverrides as AccumulationOverride[],
        decumulationOverrides:
          input.decumulationOverrides as DecumulationOverride[],
      };

      return { result: optimizeRothBracketTarget(engineInput) };
    }),
});
