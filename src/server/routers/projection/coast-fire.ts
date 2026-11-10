/**
 * Coast FIRE endpoints: `computeCoastFire` (deterministic binary search for the earliest
 * age stopping contributions still funds expenses) and `computeCoastFireMC` (Simulation).
 */
import {
  planEndAge as planEndAgeOf,
  planRetirementAge as planRetirementAgeOf,
} from "@/lib/pure/household/household-timeline";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import { findCoastFireAge } from "@/lib/pure/retirement/coast-fire";
import {
  prepareEngineInput,
  prepareProjectionRun,
} from "@/server/services/projection/projection-run";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
} from "./_shared";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";
import { computeCoastFireSimulation } from "@/server/services/projection/coast-fire";

export const coastFireRouter = createTRPCRouter({
  /**
   * Earliest age contributions can stop with the plan still funded through its end:
   * binary search on computeProjection's payload, passing when `assessPlan` passes and
   * first-year spending covers the need (see `findCoastFireAge`).
   */
  computeCoastFire: protectedProcedure
    .input(
      z.strictObject({
        // Mirrors the computeProjection input subset that affects the engine.
        decumulationDefaults: decumulationDefaultsInputSchema,
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
        selection: profileSelectionSchema.optional(),
        snapshotId: z.number().int().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { payload } = await prepareProjectionRun(ctx, {
        selection: input.selection,
        snapshotId: input.snapshotId,
      });
      if (!payload) return { result: null };
      if (payload.notConfigured)
        return { result: null, notConfigured: payload.notConfigured };

      const engineInput = await prepareEngineInput(ctx.db, payload, input);

      const result = findCoastFireAge(engineInput);

      // Deflate to today's dollars for display (as the retirement card does):
      // withdrawal and expenses at retirementAge, end balance at projectionEndAge.
      // The calculator stays pure; deflation happens at the router boundary.
      const yearsToRetirement = Math.max(
        0,
        planRetirementAgeOf(engineInput) - engineInput.currentAge,
      );
      const yearsToEnd = Math.max(
        0,
        planEndAgeOf(engineInput) - engineInput.currentAge,
      );
      const retirementDeflator = Math.pow(
        1 + engineInput.inflationRate,
        yearsToRetirement,
      );
      const endDeflator = Math.pow(1 + engineInput.inflationRate, yearsToEnd);

      return {
        result: {
          ...result,
          sustainableWithdrawalToday:
            result.sustainableWithdrawal / retirementDeflator,
          projectedExpensesAtRetirementToday:
            result.projectedExpensesAtRetirement / retirementDeflator,
          endRetirementBalanceToday: result.endRetirementBalance / endDeflator,
        },
      };
    }),

  /**
   * Earliest age stopping contributions keeps ≥90% Simulation success: binary search with
   * `COMPARISON_SEED` and the default preset. Monotonicity is approximate (tax cliffs), so
   * `lo - 1` is re-probed and a pass returns a warning. Rate-limited (~5-6 probes).
   */
  computeCoastFireMC: protectedProcedure
    .use(expensiveRateLimitMiddleware)
    .input(
      z.strictObject({
        decumulationDefaults: decumulationDefaultsInputSchema,
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
        selection: profileSelectionSchema.optional(),
        snapshotId: z.number().int().optional(),
        /** Bypass the projection cache and force a fresh search — the explicit "Re-run" action, not the default query path. */
        forceRefresh: z.boolean().optional(),
        /** Read-only cache peek — never runs the (expensive) binary search, just returns a cache hit or a null result. For cheap dashboard-tile display of "whatever the last real run found." */
        peekOnly: z.boolean().optional(),
        /** Progress-polling key (see `getMonteCarloProgress`). Probes run one at a time
         *  under the same id, so progress resets to 0 at each probe's start. */
        runId: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => computeCoastFireSimulation(ctx, input)),
});
