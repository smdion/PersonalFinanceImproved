/**
 * Coast FIRE endpoints: `computeCoastFire` (deterministic binary search for the earliest
 * age stopping contributions still funds expenses) and `computeCoastFireMC` (Simulation).
 */
import {
  planEndAge as planEndAgeOf,
  planRetirementAge as planRetirementAgeOf,
} from "@/lib/pure/household/household-timeline";
import {
  classifyAssetClasses,
  stockShareByAge,
} from "@/lib/pure/simulation/stock-share";
import { COMPARISON_SEED, DEFAULT_SIMULATION } from "@/lib/constants";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { findCoastFireAge } from "@/lib/pure/retirement/coast-fire";
import { calculateMonteCarlo } from "@/lib/pure/simulation/monte-carlo";
import { runMonteCarloOffThread } from "@/server/services/simulation/monte-carlo-worker-client";
import { SIMULATION_CONFIDENCE_THRESHOLD } from "@/lib/constants";
import {
  prepareEngineInput,
  prepareProjectionRun,
} from "@/server/services/projection/projection-run";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  buildCoastFireProfileSwitches,
} from "./_shared";
import { buildSimulationInputs } from "@/server/services/simulation/mc-inputs";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
} from "@/server/services/projection/projection-cache";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";
import { writeStamp } from "@/lib/utils/clock";

/** Shape of `computeCoastFireMC`'s cacheable result — every branch of the
 *  search. A not-configured state (no preset, classes or glide path)
 *  returns no result and is never cached. */
type CoastFireSimulationResult = {
  coastFireAge: number | null;
  status: "already_coast" | "unreachable" | "found";
  successRate: number;
  stopNowSuccessRate: number;
  /** % of stop-now trials failing because penalty-exposed money was excluded:
   *  tells "can't reach the money before 59½" from "ran out" when stopNowSuccessRate is low. */
  stopNowPenaltyAvoidedShortfallRate: number;
  /** Median dollar shortfall (today's dollars) among stop-now trials that
   *  hit a penalty-avoided shortfall -- see MonteCarloResult's
   *  medianPenaltyAvoidedShortfallPV. */
  stopNowMedianPenaltyAvoidedShortfallPV: number;
  /** Full Simulation result for stopping at the current age, for a "Coast FIRE (Today)"
   *  scenario. Null when coastAge is already the current age (`mcResult` covers it). */
  stopNowMcResult: ReturnType<typeof calculateMonteCarlo> | null;
  spendingStabilityRate: number;
  confidenceThreshold: number;
  probesRun: number;
  warning: string | null;
  mcResult: ReturnType<typeof calculateMonteCarlo>;
};

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
    .query(async ({ ctx, input }) => {
      // Engine payload + Simulation tables in parallel, like computeMonteCarloProjection
      // but on the default preset with no overrides, for reproducibility.
      const [{ payload }, simulation] = await Promise.all([
        prepareProjectionRun(ctx, {
          selection: input.selection,
          snapshotId: input.snapshotId,
        }),
        buildSimulationInputs(ctx.db, DEFAULT_SIMULATION.preset),
      ]);
      // No return rate: the projection card says so; nothing to search.
      if (!payload || payload.notConfigured)
        return { result: null, computedAt: null };

      const engineInput = await prepareEngineInput(ctx.db, payload, input);

      // No preset or nothing to draw returns from: a state, not a verdict.
      if (simulation.notConfigured || !simulation.preset)
        return {
          result: null,
          computedAt: null,
          notConfigured: simulation.notConfigured ?? ("no_presets" as const),
        };

      const { mcAssetClasses, mcCorrelations, mcGlidePath } = simulation;
      const { returnClampMin, returnClampMax } = simulation.preset;
      // VPW sizes by the stock share of the glide path the trials use.
      const classBuckets = await ctx.db.select().from(schema.assetClassBuckets);
      const mcStockShareByAge =
        stockShareByAge(
          mcGlidePath,
          classifyAssetClasses(classBuckets),
          engineInput.currentAge,
          planEndAgeOf(engineInput),
        ) ?? undefined;
      const inflationRisk = simulation.effectiveInflationRisk;

      // The probe seed is a fixed constant, so the whole search is a pure function
      // of its inputs and this cache stores no seed.
      const inputHash = hashEngineInput("coastFireMc", {
        engineInput,
        mcAssetClasses,
        mcCorrelations,
        mcGlidePath,
        mcStockShareByAge,
        returnClampMin,
        returnClampMax,
        inflationRisk,
      });
      // peekOnly always reads the real cache regardless of forceRefresh —
      // see the identical fix/rationale in monte-carlo.ts.
      const cached =
        input.forceRefresh && !input.peekOnly
          ? null
          : await readProjectionCache<CoastFireSimulationResult>(
              ctx.db,
              inputHash,
            );
      if (cached) {
        return {
          result: cached.result,
          computedAt: cached.computedAt.toISOString(),
        };
      }
      if (input.peekOnly) {
        // Cache-read-only path for dashboard tiles: never runs the (expensive)
        // binary search, just reports a prior real run if one exists.
        return { result: null, computedAt: null };
      }

      const CONFIDENCE = SIMULATION_CONFIDENCE_THRESHOLD;
      const NUM_TRIALS = DEFAULT_SIMULATION.coastFireTrials;

      // Probe: zero contributions and employer match from `coastAge` on; earlier
      // years use the configured plan. One shared seed across probes (common random
      // numbers) keeps candidate ages comparable.
      let probesRun = 0;
      const probeSimulation = (coastAge: number) => {
        probesRun += 1;
        return runMonteCarloOffThread(
          {
            engineInput: {
              ...engineInput,
              stockShareByAge: mcStockShareByAge,
              profileSwitches: buildCoastFireProfileSwitches(
                engineInput,
                coastAge,
              ),
            },
            numTrials: NUM_TRIALS,
            seed: COMPARISON_SEED,
            assetClasses: mcAssetClasses,
            returnClampMin,
            returnClampMax,
            correlations: mcCorrelations,
            glidePath: mcGlidePath,
            inflationRisk,
          },
          input.runId,
        );
      };
      const probeAt = async (coastAge: number): Promise<number> =>
        (await probeSimulation(coastAge)).successRate;

      const passes = (rate: number): boolean => rate >= CONFIDENCE;

      // Edge case: already past retirement.
      if (engineInput.currentAge >= planRetirementAgeOf(engineInput)) {
        const fullResult = await probeSimulation(engineInput.currentAge);
        const result: CoastFireSimulationResult = {
          coastFireAge: engineInput.currentAge,
          status: "already_coast" as const,
          successRate: fullResult.successRate,
          stopNowSuccessRate: fullResult.successRate,
          stopNowPenaltyAvoidedShortfallRate:
            fullResult.penaltyAvoidedShortfallRate,
          stopNowMedianPenaltyAvoidedShortfallPV:
            fullResult.medianPenaltyAvoidedShortfallPV,
          spendingStabilityRate: fullResult.spendingStabilityRate,
          confidenceThreshold: CONFIDENCE,
          probesRun,
          warning: null,
          mcResult: fullResult,
          stopNowMcResult: null,
        };
        await writeProjectionCache(ctx.db, inputHash, result, null);
        return { result, computedAt: writeStamp().toISOString() };
      }

      // Probe stopping today on every branch, so the client shows "Stopping today: X%"
      // next to the found age (quantifies a deterministic-vs-Simulation gap).
      const stopNowResult = await probeSimulation(engineInput.currentAge);
      const stopNowSuccessRate = stopNowResult.successRate;
      if (passes(stopNowSuccessRate)) {
        const result: CoastFireSimulationResult = {
          coastFireAge: engineInput.currentAge,
          status: "already_coast" as const,
          successRate: stopNowSuccessRate,
          stopNowSuccessRate,
          stopNowPenaltyAvoidedShortfallRate:
            stopNowResult.penaltyAvoidedShortfallRate,
          stopNowMedianPenaltyAvoidedShortfallPV:
            stopNowResult.medianPenaltyAvoidedShortfallPV,
          spendingStabilityRate: stopNowResult.spendingStabilityRate,
          confidenceThreshold: CONFIDENCE,
          probesRun,
          warning: null,
          mcResult: stopNowResult,
          stopNowMcResult: null,
        };
        await writeProjectionCache(ctx.db, inputHash, result, null);
        return { result, computedAt: writeStamp().toISOString() };
      }

      // Probe stopping the year before retirement — is the plan reachable at all?
      const maxCoastAge = planRetirementAgeOf(engineInput) - 1;
      const stopLateResult = await probeSimulation(maxCoastAge);
      if (!passes(stopLateResult.successRate)) {
        const result: CoastFireSimulationResult = {
          coastFireAge: null,
          status: "unreachable" as const,
          successRate: stopLateResult.successRate,
          stopNowSuccessRate,
          stopNowPenaltyAvoidedShortfallRate:
            stopNowResult.penaltyAvoidedShortfallRate,
          stopNowMedianPenaltyAvoidedShortfallPV:
            stopNowResult.medianPenaltyAvoidedShortfallPV,
          spendingStabilityRate: stopLateResult.spendingStabilityRate,
          confidenceThreshold: CONFIDENCE,
          probesRun,
          warning: null,
          mcResult: stopLateResult,
          stopNowMcResult: stopNowResult,
        };
        await writeProjectionCache(ctx.db, inputHash, result, null);
        return { result, computedAt: writeStamp().toISOString() };
      }

      // Binary search for earliest passing age.
      let lo = engineInput.currentAge + 1;
      let hi = maxCoastAge;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (passes(await probeAt(mid))) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }

      // Boundary re-probe — non-monotonicity sanity check (advisor #2).
      // If lo - 1 also passes, monotonicity broke somewhere; surface a
      // warning so the user knows the answer may be conservative.
      let warning: string | null = null;
      if (lo - 1 >= engineInput.currentAge + 1) {
        const rePrior = await probeAt(lo - 1);
        if (passes(rePrior)) {
          warning =
            "MC success rate is non-monotone near this age — the true earliest age may be lower. Likely caused by IRMAA/ACA/LTCG bracket interactions.";
        }
      }

      // One more probe at lo for the spending stability rate + full MC data
      // (chart and hero card consume the mcResult from this query).
      const finalResult = await probeSimulation(lo);

      const result: CoastFireSimulationResult = {
        coastFireAge: lo,
        status: "found" as const,
        successRate: finalResult.successRate,
        stopNowSuccessRate,
        stopNowPenaltyAvoidedShortfallRate:
          stopNowResult.penaltyAvoidedShortfallRate,
        stopNowMedianPenaltyAvoidedShortfallPV:
          stopNowResult.medianPenaltyAvoidedShortfallPV,
        spendingStabilityRate: finalResult.spendingStabilityRate,
        confidenceThreshold: CONFIDENCE,
        probesRun,
        warning,
        mcResult: finalResult,
        stopNowMcResult: stopNowResult,
      };
      await writeProjectionCache(ctx.db, inputHash, result, null);
      return { result, computedAt: writeStamp().toISOString() };
    }),
});
