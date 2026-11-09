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
import { TRPCError } from "@trpc/server";
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

/**
 * Not `CoastFireSimulationResult`: its binary-search fields have no meaning for one probe,
 * and `status: "found"` can't express a failing age. `passes` carries that answer.
 */
type CoastFireProbeResult = {
  probeAge: number;
  successRate: number;
  passes: boolean;
  spendingStabilityRate: number;
  penaltyAvoidedShortfallRate: number;
  medianPenaltyAvoidedShortfallPV: number;
  confidenceThreshold: number;
  mcResult: ReturnType<typeof calculateMonteCarlo>;
};

export async function computeCoastFireProbe(
  ctx: { db: Db; scope: RequestScope },
  input: {
    decumulationDefaults: z.output<typeof decumulationDefaultsInputSchema>;
    accumulationOverrides?: z.output<typeof accumulationOverrideArraySchema>;
    decumulationOverrides?: z.output<typeof decumulationOverrideArraySchema>;
    selection?: ProfileSelection;
    snapshotId?: number;
    probeAge: number;
    runId?: string;
  },
) {
  // Coast FIRE's Simulation runs on the default preset.
  const [{ payload }, simulation] = await Promise.all([
    prepareProjectionRun(ctx, {
      selection: input.selection,
      snapshotId: input.snapshotId,
    }),
    buildSimulationInputs(ctx.db, DEFAULT_SIMULATION.preset),
  ]);
  if (!payload || payload.notConfigured)
    return { result: null, computedAt: null };

  const engineInput = await prepareEngineInput(ctx.db, payload, input);

  // Server-side range check against the RESOLVED engine input, not
  // just the client's own bounds — same domain findCoastFireAge's
  // binary search already restricts itself to.
  if (
    input.probeAge < engineInput.currentAge ||
    input.probeAge >= planRetirementAgeOf(engineInput)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `probeAge must be in [${engineInput.currentAge}, ${planRetirementAgeOf(engineInput)})`,
    });
  }

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

  const NUM_TRIALS = DEFAULT_SIMULATION.coastFireTrials;

  // Own hashEngineInput kind: the hash covers the derived payload, so sharing
  // "coastFireMc" would let a probe overwrite the binary-search result's cache row.
  const inputHash = hashEngineInput("coastFireProbe", {
    engineInput,
    mcAssetClasses,
    mcCorrelations,
    mcGlidePath,
    mcStockShareByAge,
    returnClampMin,
    returnClampMax,
    inflationRisk,
    probeAge: input.probeAge,
  });
  const cached = await readProjectionCache<CoastFireProbeResult>(
    ctx.db,
    inputHash,
  );
  if (cached) {
    return {
      result: cached.result,
      computedAt: cached.computedAt.toISOString(),
    };
  }

  const mcResult = await runMonteCarloOffThread(
    {
      engineInput: {
        ...engineInput,
        stockShareByAge: mcStockShareByAge,
        profileSwitches: buildCoastFireProfileSwitches(
          engineInput,
          input.probeAge,
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

  const result: CoastFireProbeResult = {
    probeAge: input.probeAge,
    successRate: mcResult.successRate,
    passes: mcResult.successRate >= SIMULATION_CONFIDENCE_THRESHOLD,
    spendingStabilityRate: mcResult.spendingStabilityRate,
    penaltyAvoidedShortfallRate: mcResult.penaltyAvoidedShortfallRate,
    medianPenaltyAvoidedShortfallPV: mcResult.medianPenaltyAvoidedShortfallPV,
    confidenceThreshold: SIMULATION_CONFIDENCE_THRESHOLD,
    mcResult,
  };
  await writeProjectionCache(ctx.db, inputHash, result, null);
  return { result, computedAt: writeStamp().toISOString() };
}
