/**
 * `computeMonteCarloProjection` plus the mutations that edit its input tables
 * (`updateGlidePathAllocations`, `updateClampBounds`).
 */
import { SK_SIMULATION_CUSTOM_CLAMP_BOUNDS } from "@/lib/constants/settings-keys";
import { planEndAge as planEndAgeOf } from "@/lib/pure/household/household-timeline";
import {
  loadSimulationPreset,
  presetAssetClasses,
} from "@/server/services/simulation/simulation-preset";
import { SIMULATION_PRESET_KEYS } from "@/lib/constants";
import {
  classifyAssetClasses,
  stockShareByAge,
} from "@/lib/pure/simulation/stock-share";
import { DEFAULT_SIMULATION } from "@/lib/constants";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  scenarioProcedure,
  adminProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  calculateMonteCarlo,
  simulationNotConfigured,
} from "@/lib/pure/simulation/monte-carlo";
import {
  runMonteCarloOffThread,
  getMonteCarloProgress,
} from "@/server/services/simulation/monte-carlo-worker-client";
import {
  interpolateAllocations,
  weightedGeometricRate,
  classWeightedVolatility,
} from "@/lib/pure/simulation/random";
import { toNumber } from "@/lib/utils/numbers";
import { sumBy } from "@/lib/utils/math";
import { toSimpleTaxMode } from "@/lib/pure/tax/simple-tax-mode";
import {
  prepareEngineInput,
  prepareProjectionRun,
} from "@/server/services/projection/projection-run";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
} from "./_shared";
import { resolveInflationRisk } from "@/lib/pure/simulation/inflation-risk";
import { buildSimulationInputs } from "@/server/services/simulation/mc-inputs";
import { loadSavedAssetOverrides } from "@/server/services/simulation/simulation-preset";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
  generateSeed,
  clearProjectionCache,
} from "@/server/services/projection/projection-cache";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";
import { upsertSetting } from "@/server/data/settings";
import { writeStamp } from "@/lib/utils/clock";

export const monteCarloRouter = createTRPCRouter({
  /**
   * Runs N engine trials with returns drawn from correlated log-normal distributions
   * (asset class parameters + glide path allocations); returns percentile bands,
   * success rate and key metrics.
   */
  computeMonteCarloProjection: protectedProcedure
    .use(expensiveRateLimitMiddleware)
    .input(
      z.strictObject({
        numTrials: z
          .number()
          .int()
          .min(100)
          .max(10000)
          .default(DEFAULT_SIMULATION.numTrials),
        seed: z.number().int().optional(),
        /** Simulation preset: controls return assumptions, volatility, inflation risk, and trial count. */
        preset: z
          .enum(SIMULATION_PRESET_KEYS)
          .default(DEFAULT_SIMULATION.preset),
        /** Tax mode: 'simple' collapses to single tax-free balance (cFIREsim-comparable), 'advanced' uses full multi-account tax engine. */
        taxMode: z
          .enum(["simple", "advanced"])
          .default(DEFAULT_SIMULATION.taxMode),
        selection: profileSelectionSchema.optional(),
        /** Optional per-asset-class return/volatility overrides from the UI. */
        assetClassOverrides: z
          .array(
            z.object({
              id: z.number(),
              meanReturn: z.number().min(-0.1).max(0.3).optional(),
              stdDev: z.number().min(0).max(0.5).optional(),
            }),
          )
          .optional(),
        /** Optional salary overrides from UI (same as getProjection). */

        // --- Decumulation defaults (mirrors getProjection) ---
        decumulationDefaults: decumulationDefaultsInputSchema,

        // --- Accumulation overrides (mirrors getProjection) ---
        accumulationOverrides: accumulationOverrideSchema,

        // --- Decumulation overrides (mirrors getProjection) ---
        decumulationOverrides: decumulationOverrideSchema,

        /** Optional inflation risk: the spread of each year's inflation
         *  around the plan's own rates. */
        inflationRisk: z
          .object({ stdDev: z.number().min(0).max(0.1) })
          .optional(),
        /** Optional snapshot ID — use a historical portfolio snapshot instead of the latest. */
        snapshotId: z.number().int().optional(),
        /** Rate-Seeded scenario: seed decumulation year 1 from Initial Withdrawal Rate ×
         *  starting balance instead of the stated budget/override. Default off; see
         *  ProjectionInput.rateSeededDecumulationYear1. */
        rateSeededDecumulationYear1: z.boolean().optional(),
        /** Bypass the projection cache and force a fresh run with a new seed — the explicit "Run Monte Carlo" action, not the default query path. */
        forceRefresh: z.boolean().optional(),
        /** Read-only cache peek — never runs the (expensive) trials, just returns a cache hit or a null result. For cheap dashboard-tile display of "whatever the last real run found." */
        peekOnly: z.boolean().optional(),
        /** Optional client id (crypto.randomUUID()) to poll this run's progress under
         *  via `getMonteCarloProgress` (see monte-carlo-worker-client.ts). */
        runId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Fetch shared data + MC-specific tables + saved overrides in parallel
      const [
        { profiles, payload },
        {
          mcAssetClasses: baseSimulationAssetClasses,
          mcCorrelations,
          savedInflationOverrides,
        },
        savedAssetOverrides,
      ] = await Promise.all([
        prepareProjectionRun(ctx, {
          selection: input.selection,
          snapshotId: input.snapshotId,
        }),
        buildSimulationInputs(ctx.db),
        loadSavedAssetOverrides(ctx.db),
      ]);

      // No return rate: the projection card says so.
      if (!payload || payload.notConfigured)
        return {
          result: null,
          savedOverrides: {
            assetClassOverrides: savedAssetOverrides,
            inflationOverrides: savedInflationOverrides,
          },
        };

      const {
        settings,
        bracketData: _bracketData,
        age,
        planRetirementAge,
        planEndAge,
        totalCompensation,
        selectedScenario: _selectedScenario,
        annualExpensesVal,
      } = payload;

      // Build the full engine input — mirrors getProjection so MC respects the same overrides.
      // Note: Coast FIRE scenario rendering goes through computeCoastFireMC (which returns
      // its final-probe mcResult for the chart), NOT this procedure with a coast flag.
      const engineInput = {
        ...(await prepareEngineInput(ctx.db, payload, input)),
        rateSeededDecumulationYear1: input.rateSeededDecumulationYear1,
      };

      const retirementBuckets = payload.simpleTaxMode.retirementBuckets;

      // Simple tax mode: retirement money as one tax-free pot
      // (cFIREsim-comparable) — never Portfolio money (simple-tax-mode.ts).
      const simInput =
        input.taxMode === "simple"
          ? toSimpleTaxMode(engineInput, payload.simpleTaxMode)
          : engineInput;

      // ----- What this run's preset means (services/simulation/simulation-preset.ts) -----
      const preset = await loadSimulationPreset(ctx.db, input.preset);

      // Validate asset class override IDs match DB
      if (input.assetClassOverrides) {
        const activeIds = new Set(
          baseSimulationAssetClasses.map((ac) => ac.id),
        );
        for (const override of input.assetClassOverrides) {
          if (!activeIds.has(override.id)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "One of the asset classes you changed is no longer active — reload and try again.",
            });
          }
        }
      }

      const mcAssetClasses = presetAssetClasses(
        baseSimulationAssetClasses,
        preset,
        input.assetClassOverrides,
      );
      const mcGlidePath = preset.glidePath;
      // Nothing to draw returns from: say so rather than run on 0%.
      const notConfigured = simulationNotConfigured(
        preset,
        mcAssetClasses,
        mcGlidePath,
      );
      if (notConfigured)
        return {
          result: null,
          notConfigured,
          savedOverrides: {
            assetClassOverrides: savedAssetOverrides,
            inflationOverrides: savedInflationOverrides,
          },
        };

      const effectiveInflationRisk = resolveInflationRisk({
        ui: input.inflationRisk,
        saved: savedInflationOverrides,
        presetStdDev: preset.inflationStdDev,
      });

      const { returnClampMin, returnClampMax } = preset;

      // Deterministic return rates use GEOMETRIC means (the median compounding rate),
      // so compounding doesn't overstate growth; the stochastic trials compound
      // geometrically on their own.
      const simulationDeterministicRates: { label: string; rate: number }[] =
        [];
      for (
        let a = engineInput.currentAge;
        a <= planEndAgeOf(engineInput);
        a++
      ) {
        const allocations = interpolateAllocations(mcGlidePath, a);
        const blended = weightedGeometricRate(mcAssetClasses, allocations);
        simulationDeterministicRates.push({ label: `Age ${a}`, rate: blended });
      }
      // VPW sizes by the stock share of the glide path this run simulates.
      const classBuckets = await ctx.db.select().from(schema.assetClassBuckets);
      const mcEngineInput = {
        ...simInput,
        returnRates: simulationDeterministicRates,
        stockShareByAge:
          stockShareByAge(
            mcGlidePath,
            classifyAssetClasses(classBuckets),
            simInput.currentAge,
            planEndAgeOf(simInput),
          ) ?? undefined,
      };

      // Cache key covers every trial input plus an explicit client seed's value, so
      // identical explicit-seed requests hit cache and an unseeded request reuses the
      // seed the cache already minted.
      const simulationInputHash = hashEngineInput("monteCarlo", {
        mcEngineInput,
        numTrials: input.numTrials,
        mcAssetClasses,
        mcCorrelations,
        mcGlidePath,
        inflationRisk: effectiveInflationRisk,
        returnClampMin,
        returnClampMax,
        explicitSeed: input.seed ?? null,
      });
      // peekOnly always reads the cache, even with forceRefresh: it promises never to
      // run trials, so it wins over the contradictory force flag.
      const simulationCached =
        input.forceRefresh && !input.peekOnly
          ? null
          : await readProjectionCache<ReturnType<typeof calculateMonteCarlo>>(
              ctx.db,
              simulationInputHash,
            );

      let result: ReturnType<typeof calculateMonteCarlo> | null;
      let usedSeed: number | null;
      let computedAt: Date | null;
      if (simulationCached) {
        result = simulationCached.result;
        usedSeed = simulationCached.seed ?? input.seed ?? generateSeed();
        computedAt = simulationCached.computedAt;
      } else if (input.peekOnly) {
        // Cache-read-only path for dashboard tiles: never runs the expensive
        // trials, just reports whether a recent run already exists.
        result = null;
        usedSeed = null;
        computedAt = null;
      } else {
        usedSeed = input.seed ?? generateSeed();
        result = await runMonteCarloOffThread(
          {
            engineInput: mcEngineInput,
            numTrials: input.numTrials,
            seed: usedSeed,
            assetClasses: mcAssetClasses,
            correlations: mcCorrelations,
            glidePath: mcGlidePath,
            inflationRisk: effectiveInflationRisk,
            returnClampMin,
            returnClampMax,
          },
          input.runId,
        );
        computedAt = writeStamp();
        await writeProjectionCache(
          ctx.db,
          simulationInputHash,
          result,
          usedSeed,
        );
      }

      // Build current glide path allocation for display (interpolate at current age)
      const currentGpEntry =
        mcGlidePath.find((gp) => gp.age >= age) ?? mcGlidePath[0];

      // Compute blended portfolio return/vol for display (geometric mean = realistic compounding rate)
      const currentAllocation = currentGpEntry?.allocations ?? {};
      const blendedReturn = weightedGeometricRate(
        mcAssetClasses,
        currentAllocation,
      );
      const blendedVol = classWeightedVolatility(
        mcAssetClasses,
        currentAllocation,
      );

      // Build DB (raw) asset class values for comparison
      const dbAssetClasses = baseSimulationAssetClasses.map((ac) => ({
        id: ac.id,
        name: ac.name,
        meanReturn: ac.meanReturn,
        stdDev: ac.stdDev,
      }));

      return {
        result,
        simulationInputs: {
          seed: usedSeed,
          computedAt: computedAt?.toISOString() ?? null,
          currentAge: age,
          retirementAge: planRetirementAge,
          endAge: planEndAge,
          // Retirement money only: what the simulation's answers count.
          startingBalance:
            retirementBuckets.preTax +
            retirementBuckets.taxFree +
            retirementBuckets.hsa +
            retirementBuckets.afterTax,
          annualContributions:
            sumBy(
              Object.values(
                payload.simpleTaxMode.defaults.baseYearContributions,
              ),
              (v) => v,
            ) +
            sumBy(
              Object.values(
                payload.simpleTaxMode.defaults.baseYearEmployerMatch,
              ),
              (v) => v,
            ),
          annualExpenses: annualExpensesVal,
          inflationRate: toNumber(settings.annualInflation),
          // The rates trials vary around (inflation risk is the spread).
          postRetirementInflationRate:
            mcEngineInput.postRetirementInflationRate ??
            mcEngineInput.inflationRate,
          salary: totalCompensation,
          assetClasses: mcAssetClasses,
          dbAssetClasses,
          currentAllocation: currentAllocation,
          glidePathAges: mcGlidePath.map((gp) => gp.age),
          glidePath: mcGlidePath,
          preset: input.preset,
          presetLabel: preset.label,
          presetDescription:
            preset.description ??
            "Raw DB values — no preset adjustments applied",
          blendedReturn,
          blendedVol,
          inflationRisk: effectiveInflationRisk,
          withdrawalRate: toNumber(settings.withdrawalRate),
          withdrawalStrategy: settings.withdrawalStrategy,
          decumulationExpenseOverride: profiles.decumulationExpenseOverride,
          accumulationExpenseOverride: profiles.accumulationExpenseOverride,
          taxMode: input.taxMode,
          hasAssetClassOverrides:
            savedAssetOverrides.length > 0 ||
            (input.assetClassOverrides?.length ?? 0) > 0,
          correlations: mcCorrelations,
          returnClampMin,
          returnClampMax,
          returnMultiplier: preset.returnMultiplier,
          volMultiplier: preset.volMultiplier,
        },
        savedOverrides: {
          assetClassOverrides: savedAssetOverrides,
          inflationOverrides: savedInflationOverrides,
        },
      };
    }),

  /**
   * Live progress of an in-flight run with this `runId`, polled ~500ms by the client
   * (in-memory; see monte-carlo-worker-client.ts). Null when done, unknown or not started.
   */
  getMonteCarloProgress: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(({ input }) => {
      return getMonteCarloProgress(input.runId);
    }),

  // --- Mutations for editing projection assumptions ---

  updateGlidePathAllocations: scenarioProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({
            age: z.number().int(),
            allocations: z.record(z.string(), z.number()),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      // Delete existing custom glide path and replace
      await db.delete(schema.glidePathAllocations);
      const rows: { age: number; assetClassId: number; allocation: string }[] =
        [];
      for (const entry of input.entries) {
        for (const [idStr, allocation] of Object.entries(entry.allocations)) {
          const assetClassId = parseInt(idStr, 10);
          if (!isNaN(assetClassId)) {
            rows.push({
              age: entry.age,
              assetClassId,
              allocation: String(allocation),
            });
          }
        }
      }
      if (rows.length > 0) {
        await db.insert(schema.glidePathAllocations).values(rows);
      }
      return { updated: rows.length };
    }),

  updateClampBounds: scenarioProcedure
    .input(
      z.object({
        preset: z.enum(["custom"]),
        returnClampMin: z.number().min(-1).max(0),
        returnClampMax: z.number().min(0).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      // Custom has no preset row, so its bounds are stored as a setting.
      const value = {
        returnClampMin: input.returnClampMin,
        returnClampMax: input.returnClampMax,
      };
      await upsertSetting(db, SK_SIMULATION_CUSTOM_CLAMP_BOUNDS, value);
      return { updated: true };
    }),

  /** Wipes every cached deterministic/MC/Coast-FIRE projection row —
   *  forces a full recompute without a deploy. Admin-only: destructive
   *  against shared cache state. */
  clearCache: adminProcedure.mutation(async ({ ctx }) => {
    const cleared = await clearProjectionCache(ctx.db);
    return { cleared };
  }),
});
