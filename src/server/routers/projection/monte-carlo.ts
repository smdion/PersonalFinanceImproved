/**
 * Monte Carlo projection endpoint + related settings mutations.
 *
 * Contains the `computeMonteCarloProjection` query (the main stochastic
 * projection engine) and the scenario-scoped mutations that edit the MC
 * input tables: `updateGlidePathAllocations` and `updateClampBounds`.
 */
import { SK_MC_CUSTOM_CLAMP_BOUNDS } from "@/lib/constants/settings-keys";
import { planEndAge as planEndAgeOf } from "@/lib/pure/household-timeline";
import {
  loadSimulationPreset,
  presetAssetClasses,
} from "@/server/helpers/simulation-preset";
import { SIMULATION_PRESET_KEYS } from "@/lib/constants";
import { classifyAssetClasses, stockShareByAge } from "@/lib/pure/stock-share";
import { DEFAULT_SIMULATION } from "@/lib/constants";
import { eq } from "drizzle-orm";
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
} from "@/lib/calculators/monte-carlo";
import {
  runMonteCarloOffThread,
  getMonteCarloProgress,
} from "@/server/helpers/monte-carlo-worker-client";
import {
  interpolateAllocations,
  geometricMean,
} from "@/lib/calculators/random";
import { toNumber } from "@/server/helpers";
import { sumBy } from "@/lib/utils/math";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/pure/engine/types";
import { toSimpleTaxMode } from "@/lib/pure/tax/simple-tax-mode";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  buildDecumulationDefaults,
  buildMcInputs,
  resolveInflationRisk,
  resolveProjectionOverrides,
} from "./_shared";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
  generateSeed,
  clearProjectionCache,
} from "@/server/helpers/projection-cache";
import { engineProfileOptions } from "@/lib/pure/household/profile-selection";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

export const monteCarloRouter = createTRPCRouter({
  /**
   * Monte Carlo Projection
   *
   * Runs N trials of the contribution engine with randomized return rates
   * sampled from correlated log-normal distributions based on asset class
   * parameters and glide path allocations from the DB.
   *
   * Returns percentile bands for fan chart, success rate, and key metrics.
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
        /** Rate-Seeded scenario: re-seed year
         *  1 of decumulation from the Initial Withdrawal Rate × starting
         *  balance instead of the stated budget/override. See
         *  ProjectionInput.rateSeededDecumulationYear1's docblock for the
         *  full contract. Default false/undefined — byte-identical to
         *  today's behavior. */
        rateSeededDecumulationYear1: z.boolean().optional(),
        /** Bypass the projection cache and force a fresh run with a new seed — the explicit "Run Monte Carlo" action, not the default query path. */
        forceRefresh: z.boolean().optional(),
        /** Read-only cache peek — never runs the (expensive) trials, just returns a cache hit or a null result. For cheap dashboard-tile display of "whatever the last real run found." */
        peekOnly: z.boolean().optional(),
        /** Client-generated id (crypto.randomUUID()) this same request's
         *  in-flight progress can be polled under via
         *  `getMonteCarloProgress` — see monte-carlo-worker-client.ts.
         *  Optional: omit for call sites that don't need live progress. */
        runId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const profiles = engineProfileOptions(input.selection);
      // Fetch shared data + MC-specific tables + saved overrides in parallel
      const [
        data,
        {
          mcAssetClasses: baseMcAssetClasses,
          mcCorrelations,
          savedInflationOverrides,
        },
        savedAssetOverridesRow,
      ] = await Promise.all([
        fetchRetirementData(ctx.db, {
          snapshotId: input.snapshotId,
          contributionProfileId: profiles.contributionProfileId,
          salaryProfileId: profiles.salaryProfileId,
        }),
        buildMcInputs(ctx.db),
        ctx.db
          .select({ value: schema.appSettings.value })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, "mc_asset_class_overrides"))
          .then((r) => r[0] ?? null),
      ]);

      // Merge saved overrides: UI-provided overrides take priority over DB-saved ones
      const savedAssetOverrides = (savedAssetOverridesRow?.value ?? []) as {
        id: number;
        meanReturn?: number;
        stdDev?: number;
      }[];

      const payload = await buildEnginePayload(ctx.db, data, {
        ...profiles,
      });
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
        distributionTaxRates,
        annualExpensesVal,
        baseEngineInput,
      } = payload;

      // Build the full engine input — mirrors getProjection so MC respects the same overrides.
      // Note: Coast FIRE scenario rendering goes through computeCoastFireMC (which returns
      // its final-probe mcResult for the chart), NOT this procedure with a coast flag.
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
        rateSeededDecumulationYear1: input.rateSeededDecumulationYear1,
      };

      const retirementBuckets = payload.simpleTaxMode.retirementBuckets;

      // Simple tax mode: retirement money as one tax-free pot
      // (cFIREsim-comparable) — never Portfolio money (simple-tax-mode.ts).
      const simInput =
        input.taxMode === "simple"
          ? toSimpleTaxMode(engineInput, payload.simpleTaxMode)
          : engineInput;

      // ----- What this run's preset means (helpers/simulation-preset.ts) -----
      const preset = await loadSimulationPreset(ctx.db, input.preset);

      // Validate asset class override IDs match DB
      if (input.assetClassOverrides) {
        const activeIds = new Set(baseMcAssetClasses.map((ac) => ac.id));
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
        baseMcAssetClasses,
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

      // Build MC-aligned deterministic return rates using GEOMETRIC means.
      // The arithmetic mean is the expected single-year return, but deterministic compounding
      // should use the geometric mean (median compounding rate) to avoid overstating growth.
      // The MC stochastic trials naturally produce geometric compounding through randomization.
      const mcDeterministicRates: { label: string; rate: number }[] = [];
      for (
        let a = engineInput.currentAge;
        a <= planEndAgeOf(engineInput);
        a++
      ) {
        const allocations = interpolateAllocations(mcGlidePath, a);
        const blended = sumBy(mcAssetClasses, (ac) => {
          const w = allocations[ac.id] ?? 0;
          return w > 0 ? w * geometricMean(ac.meanReturn, ac.stdDev) : 0;
        });
        mcDeterministicRates.push({ label: `Age ${a}`, rate: blended });
      }
      // VPW sizes by the stock share of the glide path this run simulates.
      const classBuckets = await ctx.db.select().from(schema.assetClassBuckets);
      const mcEngineInput = {
        ...simInput,
        returnRates: mcDeterministicRates,
        stockShareByAge:
          stockShareByAge(
            mcGlidePath,
            classifyAssetClasses(classBuckets),
            simInput.currentAge,
            planEndAgeOf(simInput),
          ) ?? undefined,
      };

      // Cache key covers every input that feeds the trials themselves —
      // NOT input.seed's absence/presence directly, but its explicit value
      // (an explicit client seed is a distinct request from "give me
      // whatever's cached or fresh"), so identical explicit-seed requests
      // still hit cache while an unseeded request reuses whatever seed the
      // cache already minted.
      const mcInputHash = hashEngineInput("monteCarlo", {
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
      // peekOnly always reads the real cache regardless of forceRefresh —
      // its whole contract is "report what's cached, never compute," which
      // forceRefresh's cache bypass would otherwise silently override,
      // returning an empty peek instead of running a fresh computation OR
      // honoring the peek. The two flags are semantically contradictory
      // together (peek = don't compute, force = compute fresh); peekOnly
      // wins since it's the one that promises never to run trials.
      const mcCached =
        input.forceRefresh && !input.peekOnly
          ? null
          : await readProjectionCache<ReturnType<typeof calculateMonteCarlo>>(
              ctx.db,
              mcInputHash,
            );

      let result: ReturnType<typeof calculateMonteCarlo> | null;
      let usedSeed: number | null;
      let computedAt: Date | null;
      if (mcCached) {
        result = mcCached.result;
        usedSeed = mcCached.seed ?? input.seed ?? generateSeed();
        computedAt = mcCached.computedAt;
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
        computedAt = new Date();
        await writeProjectionCache(ctx.db, mcInputHash, result, usedSeed);
      }

      // Build current glide path allocation for display (interpolate at current age)
      const currentGpEntry =
        mcGlidePath.find((gp) => gp.age >= age) ?? mcGlidePath[0];

      // Compute blended portfolio return/vol for display (geometric mean = realistic compounding rate)
      const currentAlloc = currentGpEntry?.allocations ?? {};
      const blendedReturn = sumBy(mcAssetClasses, (ac) => {
        const w = currentAlloc[ac.id] ?? 0;
        return w > 0 ? w * geometricMean(ac.meanReturn, ac.stdDev) : 0;
      });
      const blendedVol = sumBy(
        mcAssetClasses,
        (ac) => ac.stdDev * (currentAlloc[ac.id] ?? 0),
      );

      // Build DB (raw) asset class values for comparison
      const dbAssetClasses = baseMcAssetClasses.map((ac) => ({
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
          currentAllocation: currentAlloc,
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
          withdrawalStrategy: settings.withdrawalStrategy ?? "fixed",
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
   * Live progress for an in-flight `computeMonteCarloProjection` (or any
   * other `runMonteCarloOffThread` call passed the same `runId`). Cheap,
   * meant to be polled every ~500ms by the client while a simulation is
   * running — see monte-carlo-worker-client.ts's module docblock for why
   * this is an in-memory Map rather than a DB table or a subscription.
   * Returns null once the job is done or if the runId is unknown (e.g. the
   * job hasn't reached the worker's queue front yet, or the poll started
   * after the run already finished).
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
        for (const [idStr, alloc] of Object.entries(entry.allocations)) {
          const assetClassId = parseInt(idStr, 10);
          if (!isNaN(assetClassId)) {
            rows.push({
              age: entry.age,
              assetClassId,
              allocation: String(alloc),
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
      // Custom has no preset row (this used to update nothing): a setting.
      const value = {
        returnClampMin: input.returnClampMin,
        returnClampMax: input.returnClampMax,
      };
      await db
        .insert(schema.appSettings)
        .values({ key: SK_MC_CUSTOM_CLAMP_BOUNDS, value })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value },
        });
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
