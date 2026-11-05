/**
 * Coast FIRE — Custom Age probe.
 *
 * `computeCoastFireMC`/`findCoastFireAge` only ever answer "what's the
 * earliest passing age" (binary search) or "does today work" (the
 * search's own `stopNowResult`). This endpoint answers a third question:
 * "what happens if I stop at age N specifically," for any N the household
 * picks. Split into its own file (not a param bolted onto
 * `computeCoastFireMC`) because the result shape is genuinely different —
 * see `CoastFireProbeResult`'s docblock — and because `coast-fire.ts` is
 * already at 521 lines, over CONTRIBUTING.md § Composed Router Convention's ~500-line
 * guideline.
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
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { calculateMonteCarlo } from "@/lib/pure/simulation/monte-carlo";
import { runMonteCarloOffThread } from "@/server/services/simulation/monte-carlo-worker-client";
import { MC_CONFIDENCE_THRESHOLD } from "@/lib/constants";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/pure/engine/types";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  buildDecumulationDefaults,
  buildCoastFireProfileSwitches,
  resolveProjectionOverrides,
} from "./_shared";
import { buildMcInputs } from "@/server/services/simulation/mc-inputs";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
} from "@/server/services/projection/projection-cache";
import { engineProfileOptions } from "@/lib/pure/household/profile-selection";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

/**
 * Deliberately NOT `CoastFireMcResult` (computeCoastFireMC's shape).
 * `status`/`coastFireAge`/`warning`/`probesRun`/`stopNow*` are all
 * binary-search concepts a single probe doesn't have an answer for —
 * most importantly, `status: "found"` cannot represent a FAILING probe,
 * and the single most valuable answer this endpoint gives is "no, that
 * age doesn't work." `passes` carries that instead, as a plain boolean.
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

export const coastFireProbeRouter = createTRPCRouter({
  /**
   * Coast FIRE — Custom Age probe
   *
   * Runs a single Monte Carlo simulation with contributions (and employer
   * match) zeroed from `probeAge` onward, answering "what happens if I
   * stop at this specific age" for any age the household picks — not just
   * the binary search's earliest-passing-age or "today." Reuses the same
   * `buildCoastFireProfileSwitches` probe mechanism `computeCoastFireMC`'s
   * binary search already uses; no new simulation logic. Returns
   * `CoastFireProbeResult`, deliberately NOT `computeCoastFireMC`'s
   * `CoastFireMcResult` shape — see that type's own docblock for why.
   */
  computeCoastFireProbe: protectedProcedure
    .use(expensiveRateLimitMiddleware)
    .input(
      z.strictObject({
        decumulationDefaults: decumulationDefaultsInputSchema,
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
        selection: profileSelectionSchema.optional(),
        snapshotId: z.number().int().optional(),
        /** The age to probe. Validated server-side below against the
         *  RESOLVED engine input's own currentAge/retirementAge — client
         *  bounds aren't trustworthy, and buildCoastFireProfileSwitches
         *  has no guard of its own against an out-of-range age. */
        probeAge: z.number().int(),
        /** Progress-polling key — see `getMonteCarloProgress`'s docblock. */
        runId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const profiles = engineProfileOptions(input.selection);
      // Coast FIRE's Simulation runs on the default preset.
      const [data, mc] = await Promise.all([
        fetchRetirementData(ctx.db, {
          snapshotId: input.snapshotId,
          contributionProfileId: profiles.contributionProfileId,
          salaryProfileId: profiles.salaryProfileId,
        }),
        buildMcInputs(ctx.db, DEFAULT_SIMULATION.preset),
      ]);

      const payload = await buildEnginePayload(ctx.db, data, {
        ...profiles,
      });
      if (!payload || payload.notConfigured)
        return { result: null, computedAt: null };

      const { settings, distributionTaxRates, baseEngineInput } = payload;

      const engineInput = {
        ...baseEngineInput,
        decumulationDefaults: buildDecumulationDefaults(
          settings,
          input.decumulationDefaults,
          distributionTaxRates,
        ),
        // Omitted "Changes by year" = the household's saved rows.
        ...((await resolveProjectionOverrides(ctx.db, input)) as {
          accumulationOverrides: AccumulationOverride[];
          decumulationOverrides: DecumulationOverride[];
        }),
      };

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

      if (mc.notConfigured || !mc.preset)
        return {
          result: null,
          computedAt: null,
          notConfigured: mc.notConfigured ?? ("no_presets" as const),
        };

      const { mcAssetClasses, mcCorrelations, mcGlidePath } = mc;
      const { returnClampMin, returnClampMax } = mc.preset;
      // VPW sizes by the stock share of the glide path the trials use.
      const classBuckets = await ctx.db.select().from(schema.assetClassBuckets);
      const mcStockShareByAge =
        stockShareByAge(
          mcGlidePath,
          classifyAssetClasses(classBuckets),
          engineInput.currentAge,
          planEndAgeOf(engineInput),
        ) ?? undefined;
      const inflationRisk = mc.effectiveInflationRisk;

      const NUM_TRIALS = DEFAULT_SIMULATION.coastFireTrials;

      // Own hashEngineInput `kind` -- "coastFireProbe", never
      // "coastFireMc". hashEngineInput hashes this DERIVED payload, not
      // the raw tRPC input, so reusing computeCoastFireMC's "coastFireMc"
      // kind here would let a probe's writeProjectionCache silently
      // overwrite the real binary-search result under the same cache row.
      // The kind union exists precisely so differently-shaped results can't
      // collide like that.
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
        passes: mcResult.successRate >= MC_CONFIDENCE_THRESHOLD,
        spendingStabilityRate: mcResult.spendingStabilityRate,
        penaltyAvoidedShortfallRate: mcResult.penaltyAvoidedShortfallRate,
        medianPenaltyAvoidedShortfallPV:
          mcResult.medianPenaltyAvoidedShortfallPV,
        confidenceThreshold: MC_CONFIDENCE_THRESHOLD,
        mcResult,
      };
      await writeProjectionCache(ctx.db, inputHash, result, null);
      return { result, computedAt: new Date().toISOString() };
    }),
});
