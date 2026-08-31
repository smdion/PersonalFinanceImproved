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
 * already at 521 lines, over RULES.md §8's ~500-line Composed Router
 * guideline.
 *
 * See .scratch/docs/plans/PLAN-coast-fire-custom-age.md for the full
 * design (advisor-reviewed 2026-08-30) this implements.
 */
import { eq, asc, sql } from "drizzle-orm";
import { queryRaw } from "@/lib/db/compat";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import { runMonteCarloOffThread } from "@/server/helpers/monte-carlo-worker-client";
import { toNumber } from "@/server/helpers";
import { MC_CONFIDENCE_THRESHOLD } from "@/lib/constants";
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
  buildCoastFireProfileSwitches,
} from "./_shared";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
} from "@/server/helpers/projection-cache";

/**
 * Deliberately NOT `CoastFireMcResult` (computeCoastFireMC's shape).
 * `status`/`coastFireAge`/`warning`/`probesRun`/`stopNow*` are all
 * binary-search concepts a single probe doesn't have an answer for —
 * most importantly, `status: "found"` cannot represent a FAILING probe,
 * and the single most valuable answer this endpoint gives is "no, that
 * age doesn't work." `passes` carries that instead, as a plain boolean.
 */
export type CoastFireProbeResult = {
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
      z.object({
        decumulationDefaults: decumulationDefaultsInputSchema,
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
        salaryActiveFields: z
          .array(z.object({ personId: z.number(), salary: z.number() }))
          .optional(),
        contributionProfileId: z.number().int().optional(),
        salaryProfileId: z.number().int().optional(),
        accumulationBudgetProfileId: z.number().int().optional(),
        accumulationBudgetColumn: z.number().int().min(0).optional(),
        accumulationExpenseOverride: z.number().min(0).optional(),
        decumulationBudgetProfileId: z.number().int().optional(),
        decumulationBudgetColumn: z.number().int().min(0).optional(),
        decumulationExpenseOverride: z.number().min(0).optional(),
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
      const [data, assetClasses, assetCorrelations, presetRows, presetGpRows] =
        await Promise.all([
          fetchRetirementData(ctx.db, {
            snapshotId: input.snapshotId,
            contributionProfileId: input.contributionProfileId,
            salaryProfileId: input.salaryProfileId,
          }),
          ctx.db
            .select()
            .from(schema.assetClassParams)
            .where(eq(schema.assetClassParams.isActive, true))
            .orderBy(asc(schema.assetClassParams.sortOrder)),
          ctx.db.select().from(schema.assetClassCorrelations),
          ctx.db
            .select()
            .from(schema.mcPresets)
            .where(eq(schema.mcPresets.key, "default")),
          queryRaw<{
            age: number;
            asset_class_id: number;
            allocation: string;
          }>(
            ctx.db,
            sql`SELECT gp.age, gp.asset_class_id, gp.allocation
                FROM mc_preset_glide_paths gp
                JOIN mc_presets p ON p.id = gp.preset_id
                WHERE p.key = 'default'
                ORDER BY gp.age, gp.asset_class_id`,
          ),
        ]);

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
      if (!payload) return { result: null, computedAt: null };

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

      // Server-side range check against the RESOLVED engine input, not
      // just the client's own bounds — same domain findCoastFireAge's
      // binary search already restricts itself to.
      if (
        input.probeAge < engineInput.currentAge ||
        input.probeAge >= engineInput.retirementAge
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `probeAge must be in [${engineInput.currentAge}, ${engineInput.retirementAge})`,
        });
      }

      const preset = presetRows[0];
      if (!preset) {
        return { result: null, computedAt: null };
      }

      const returnMultiplier = toNumber(preset.returnMultiplier);
      const volMultiplier = toNumber(preset.volMultiplier);
      const mcAssetClasses = assetClasses.map((ac) => ({
        id: ac.id,
        name: ac.name,
        meanReturn: toNumber(ac.meanReturn) * returnMultiplier,
        stdDev: toNumber(ac.stdDev) * volMultiplier,
      }));
      const mcCorrelations = assetCorrelations.map((c) => ({
        classAId: c.classAId,
        classBId: c.classBId,
        correlation: toNumber(c.correlation),
      }));
      const gpByAge = new Map<number, Record<number, number>>();
      for (const row of presetGpRows) {
        if (!gpByAge.has(row.age)) gpByAge.set(row.age, {});
        gpByAge.get(row.age)![row.asset_class_id] = toNumber(row.allocation);
      }
      const mcGlidePath = Array.from(gpByAge.entries())
        .sort(([a], [b]) => a - b)
        .map(([gpAge, allocations]) => ({ age: gpAge, allocations }));
      const inflationRisk = {
        meanRate: toNumber(preset.inflationMean),
        stdDev: toNumber(preset.inflationStdDev),
      };

      const NUM_TRIALS = 1000;
      const SEED = 42;

      // Own hashEngineInput `kind` -- "coastFireProbe", never
      // "coastFireMc". hashEngineInput hashes this DERIVED payload, not
      // the raw tRPC input, so reusing computeCoastFireMC's "coastFireMc"
      // kind here would let a probe's writeProjectionCache silently
      // overwrite the real binary-search result under the same cache row
      // (found in advisor review, 2026-08-30 -- see the plan doc). The
      // kind union exists precisely so differently-shaped results can't
      // collide like that.
      const inputHash = hashEngineInput("coastFireProbe", {
        engineInput,
        mcAssetClasses,
        mcCorrelations,
        mcGlidePath,
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
            profileSwitches: buildCoastFireProfileSwitches(
              engineInput,
              input.probeAge,
            ),
          },
          numTrials: NUM_TRIALS,
          seed: SEED,
          assetClasses: mcAssetClasses,
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
