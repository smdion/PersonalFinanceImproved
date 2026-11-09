import type { z } from "zod/v4";
import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import type { ProfileSelection } from "@/lib/pure/household/profile-selection.schema";
import type {
  decumulationDefaultsInputSchema,
  decumulationOverrideArraySchema,
} from "@/lib/pure/engine/types";
import type { accumulationOverrideArraySchema } from "@/server/services/projection/projection-run";
import {
  planEndAge as planEndAgeOf,
  planRetirementAge as planRetirementAgeOf,
} from "@/lib/pure/household/household-timeline";
import {
  classifyAssetClasses,
  stockShareByAge,
} from "@/lib/pure/simulation/stock-share";
import {
  COMPARISON_SEED,
  DEFAULT_SIMULATION,
  SIMULATION_CONFIDENCE_THRESHOLD,
} from "@/lib/constants";
import * as schema from "@/lib/db/schema";
import { calculateMonteCarlo } from "@/lib/pure/simulation/monte-carlo";
import { runMonteCarloOffThread } from "@/server/services/simulation/monte-carlo-worker-client";
import {
  prepareEngineInput,
  prepareProjectionRun,
} from "@/server/services/projection/projection-run";
import { buildCoastFireProfileSwitches } from "@/lib/pure/retirement/coast-fire";
import { buildSimulationInputs } from "@/server/services/simulation/mc-inputs";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
} from "@/server/services/projection/projection-cache";
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

export async function computeCoastFireSimulation(
  ctx: { db: Db; scope: RequestScope },
  input: {
    decumulationDefaults: z.output<typeof decumulationDefaultsInputSchema>;
    accumulationOverrides?: z.output<typeof accumulationOverrideArraySchema>;
    decumulationOverrides?: z.output<typeof decumulationOverrideArraySchema>;
    selection?: ProfileSelection;
    snapshotId?: number;
    forceRefresh?: boolean;
    peekOnly?: boolean;
    runId?: string;
  },
) {
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
      : await readProjectionCache<CoastFireSimulationResult>(ctx.db, inputHash);
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
          profileSwitches: buildCoastFireProfileSwitches(engineInput, coastAge),
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
}
