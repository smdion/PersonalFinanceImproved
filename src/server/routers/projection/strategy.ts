/**
 * `computeStrategyComparison`, `analyzeStrategy` and `updateAssetClassOverrides`. Both
 * procedures build decumulation defaults via `buildDecumulationDefaults` (_shared.ts) and
 * override only the compared variable (withdrawalStrategy + strategyParams per candidate).
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
import { SIMULATION_PRESET_KEYS } from "@/lib/constants";
import { strategySpending } from "@/lib/pure/retirement/strategy-spending";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  scenarioProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { readStoredStrategy } from "@/lib/db/stored-strategy-key";
import { calculateProjection } from "@/lib/pure/engine";
import { runMonteCarloOffThread } from "@/server/services/simulation/monte-carlo-worker-client";
import type { SimulationNotConfigured } from "@/lib/pure/simulation/monte-carlo";
import {
  interpolateAllocations,
  weightedGeometricRate,
} from "@/lib/pure/simulation/random";
import { formatPercent } from "@/lib/utils/percent";
import { SIMULATION_CONFIDENCE_THRESHOLD } from "@/lib/constants";
import { roundToCents, safeDivide } from "@/lib/utils/math";
import { buildEnginePayload } from "@/server/services/projection/engine-payload/build-engine-payload";
import { prepareProjectionRun } from "@/server/services/projection/projection-run";
import { buildSocialSecurityEntries } from "@/lib/pure/retirement/social-security-entries";
import { computeAdjustedBenefit } from "@/lib/pure/retirement/social-security";
import { parseAnnualPia } from "@/lib/config/social-security";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import {
  getAllStrategyKeys,
  getStrategyMeta,
  getStrategyDefaults,
} from "@/lib/config/withdrawal-strategies";
import {
  buildStrategyParams,
  buildDecumulationDefaults,
  resolveProjectionOverrides,
  resolveSsStartAgeBaseline,
} from "./_shared";
import { buildSimulationInputs } from "@/server/services/simulation/mc-inputs";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/pure/engine/types";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
} from "@/server/services/projection/projection-cache";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";
import { upsertSetting } from "@/server/data/settings";

/** The mean of `values`; 0 when there are none. */
function average(values: readonly number[]): number {
  const total = values.reduce((s, v) => s + v, 0);
  return safeDivide(total, values.length, 0);
}

export const strategyRouter = createTRPCRouter({
  /**
   * Compare all withdrawal strategies side-by-side.
   *
   * Fetches DB data once, then runs calculateProjection() for each strategy
   * varying only withdrawalStrategy + strategyParams.
   */
  computeStrategyComparison: protectedProcedure
    .input(
      z
        .strictObject({
          /** Simulation preset (the page's selector); the Default preset
           *  when absent. */
          preset: z.enum(SIMULATION_PRESET_KEYS).optional(),
          selection: profileSelectionSchema.optional(),
          snapshotId: z.number().int().optional(),
          /** Bypass the projection cache and force a fresh comparison — the explicit "Refresh" action, not the default query path. */
          forceRefresh: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      // The household's saved "Changes by year" apply to every strategy
      // (D6) — a comparison without them describes a different plan.
      const saved = (await resolveProjectionOverrides(ctx.db, {})) as {
        accumulationOverrides: AccumulationOverride[];
        decumulationOverrides: DecumulationOverride[];
      };
      const [
        { payload },
        {
          mcAssetClasses,
          mcCorrelations,
          mcGlidePath,
          effectiveInflationRisk,
          preset,
          notConfigured,
        },
      ] = await Promise.all([
        prepareProjectionRun(ctx, {
          selection: input?.selection,
          snapshotId: input?.snapshotId,
        }),
        buildSimulationInputs(
          ctx.db,
          input?.preset ?? DEFAULT_SIMULATION.preset,
        ),
      ]);
      if (!payload) return { strategies: [], activeStrategy: null };
      if (payload.notConfigured)
        return {
          strategies: [],
          activeStrategy: null,
          notConfigured: payload.notConfigured,
        };

      const {
        settings,
        distributionTaxRates,
        baseEngineInput,
        planRetirementAge,
      } = payload;

      // Build MC-aligned deterministic return rates using geometric means
      const simulationReturnRates: { label: string; rate: number }[] = [];
      for (
        let a = baseEngineInput.currentAge;
        a <= planEndAgeOf(baseEngineInput);
        a++
      ) {
        const allocations = interpolateAllocations(mcGlidePath, a);
        const blended = weightedGeometricRate(mcAssetClasses, allocations);
        simulationReturnRates.push({ label: `Age ${a}`, rate: blended });
      }
      const classBuckets = await ctx.db.select().from(schema.assetClassBuckets);
      const mcBaseEngineInput = {
        ...baseEngineInput,
        returnRates: simulationReturnRates,
        // VPW sizes by the stock share of the glide path this run uses.
        stockShareByAge:
          stockShareByAge(
            mcGlidePath,
            classifyAssetClasses(classBuckets),
            baseEngineInput.currentAge,
            planEndAgeOf(baseEngineInput),
          ) ?? undefined,
      };
      // Without a runnable Simulation the comparison still shows each
      // strategy, with no Success or Stability, and says why.
      const hasMcData = notConfigured === null;

      const userStrategyParams = buildStrategyParams(settings);
      const activeStrategy = readStoredStrategy(settings.withdrawalStrategy);

      // Resolved once; each candidate overrides only withdrawalStrategy/strategyParams,
      // so the household's RMD/QCD/routing/order/splits settings apply to all of them
      // (no client override slot: persisted profile defaults).
      const baseDecumulationDefaults = buildDecumulationDefaults(
        settings,
        { withdrawalTaxPreference: {} },
        distributionTaxRates,
      );

      // Every strategy's lightweight Simulation uses fixed seed 42 (common random
      // numbers for a fair comparison), so no seed needs persisting.
      type StrategyComparisonResult = {
        /** The Simulation preset behind the Success and Stability columns. */
        presetLabel: string;
        /** Why those columns are empty (simulationNotConfigured), or null. */
        notConfigured: SimulationNotConfigured | null;
        strategies: Awaited<ReturnType<typeof buildStrategyResults>>;
        activeStrategy: WithdrawalStrategyType;
        retirementAge: number;
      };
      // `decumulationDefaults` holds the strategy, its params, distributionTaxRates and
      // every RMD/QCD/routing setting, so changing any of them misses the cache, as the
      // other cache sites hash their full engine input. Old rows orphan and evict.
      const inputHash = hashEngineInput("strategyComparison", {
        baseEngineInput,
        mcBaseEngineInput,
        // The saved Changes by year every strategy runs with — a new saved
        // row must miss the cache, not serve the comparison without it.
        savedOverrides: saved,
        decumulationDefaults: baseDecumulationDefaults,
        hasMcData,
        mcAssetClasses,
        mcCorrelations,
        mcGlidePath,
        inflationRisk: effectiveInflationRisk,
        returnClampMin: preset!.returnClampMin,
        returnClampMax: preset!.returnClampMax,
      });
      const cached = input?.forceRefresh
        ? null
        : await readProjectionCache<StrategyComparisonResult>(
            ctx.db,
            inputHash,
          );
      if (cached) {
        return cached.result;
      }

      function buildStrategyResults() {
        return Promise.all(
          getAllStrategyKeys().map(async (strategyKey) => {
            const meta = getStrategyMeta(strategyKey);
            // Use user-configured params for the active strategy, defaults for others
            const params =
              strategyKey === activeStrategy
                ? userStrategyParams
                : { [strategyKey]: getStrategyDefaults(strategyKey) };

            const decumulationDefaults = {
              ...baseDecumulationDefaults,
              withdrawalStrategy: strategyKey,
              strategyParams: params,
            };

            const result = calculateProjection({
              ...baseEngineInput,
              decumulationDefaults,
              ...saved,
            });

            // Extract decumulation years for year-by-year data
            const decumulationYears = result.projectionByYear.filter(
              (y): y is Extract<typeof y, { phase: "decumulation" }> =>
                y.phase === "decumulation",
            );

            const withdrawals = decumulationYears.map((y) => y.totalWithdrawal);
            // What each strategy has the household spend — comparable across
            // strategies whether Social Security comes out of a strategy's
            // amount or on top of it (withdrawals alone aren't).
            const spendings = decumulationYears.map(strategySpending);
            const avgWithdrawal = average(withdrawals);

            // Run lightweight MC (200 trials) for success rate + spending stability
            let successRate: number | null = null;
            let spendingStabilityRate: number | null = null;
            let budgetStabilityRate: number | null = null;
            if (hasMcData) {
              const mcResult = await runMonteCarloOffThread({
                engineInput: {
                  ...mcBaseEngineInput,
                  decumulationDefaults,
                  ...saved,
                },
                numTrials: 200,
                seed: COMPARISON_SEED,
                assetClasses: mcAssetClasses,
                correlations: mcCorrelations,
                glidePath: mcGlidePath,
                inflationRisk: effectiveInflationRisk,
                returnClampMin: preset!.returnClampMin,
                returnClampMax: preset!.returnClampMax,
              });
              successRate = mcResult.successRate;
              spendingStabilityRate = mcResult.spendingStabilityRate;
              budgetStabilityRate = mcResult.budgetStabilityRate;
            }

            return {
              strategy: strategyKey,
              label: meta.label,
              shortLabel: meta.shortLabel,
              // The plan judge's verdict for this strategy's baseline.
              ...(({ failureAge, failureYear, failureReason }) => ({
                failureAge,
                failureYear,
                failureReason,
              }))(assessPlan(result)),
              // No sustainableWithdrawal: nothing renders it, and it would either
              // duplicate year1Withdrawal or, in RMD years, read as a second
              // differently-computed withdrawal.
              year1Spending: roundToCents(spendings[0] ?? 0),
              avgAnnualSpending: roundToCents(average(spendings)),
              year1Withdrawal: decumulationYears[0]?.totalWithdrawal ?? 0,
              avgAnnualWithdrawal: roundToCents(avgWithdrawal),
              minAnnualWithdrawal:
                withdrawals.length > 0
                  ? roundToCents(Math.min(...withdrawals))
                  : 0,
              maxAnnualWithdrawal:
                withdrawals.length > 0
                  ? roundToCents(Math.max(...withdrawals))
                  : 0,
              endRetirementBalance:
                decumulationYears.length > 0
                  ? decumulationYears[decumulationYears.length - 1]!
                      .retirementBalance
                  : 0,
              legacyAmount:
                decumulationYears.length > 0
                  ? decumulationYears[decumulationYears.length - 1]!
                      .retirementBalance
                  : 0,
              successRate,
              spendingStabilityRate,
              budgetStabilityRate,
              yearByYear: decumulationYears.map((y, i) => ({
                age: y.age,
                year: y.year,
                withdrawal: roundToCents(y.totalWithdrawal),
                spending: roundToCents(spendings[i] ?? 0),
                retirementBalance: roundToCents(y.retirementBalance),
              })),
            };
          }),
        );
      }

      const result: StrategyComparisonResult = {
        strategies: await buildStrategyResults(),
        activeStrategy,
        presetLabel: preset!.label,
        notConfigured,
        retirementAge: planRetirementAge,
      };
      await writeProjectionCache(ctx.db, inputHash, result, null);
      return result;
    }),

  /** Analyze the active strategy — run what-if MC scenarios and return ranked recommendations. */
  analyzeStrategy: protectedProcedure
    .use(expensiveRateLimitMiddleware)
    .input(
      z
        .strictObject({
          /** Simulation preset (the page's selector); the Default preset
           *  when absent. */
          preset: z.enum(SIMULATION_PRESET_KEYS).optional(),
          selection: profileSelectionSchema.optional(),
          snapshotId: z.number().int().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      // The household's saved "Changes by year" apply to every strategy
      // (D6) — a comparison without them describes a different plan.
      const saved = (await resolveProjectionOverrides(ctx.db, {})) as {
        accumulationOverrides: AccumulationOverride[];
        decumulationOverrides: DecumulationOverride[];
      };
      const [
        { profiles, data, payload },
        {
          mcAssetClasses,
          mcCorrelations,
          mcGlidePath,
          effectiveInflationRisk,
          preset,
          notConfigured,
        },
      ] = await Promise.all([
        prepareProjectionRun(ctx, {
          selection: input?.selection,
          snapshotId: input?.snapshotId,
        }),
        buildSimulationInputs(
          ctx.db,
          input?.preset ?? DEFAULT_SIMULATION.preset,
        ),
      ]);

      if (!payload)
        return {
          baseline: null,
          recommendations: [],
          diagnosis: null as string | null,
          strategyLabel: "",
        };

      const {
        settings,
        distributionTaxRates,
        baseEngineInput,
        perPersonSettings,
      } = payload;

      if (notConfigured)
        return {
          baseline: null,
          recommendations: [],
          diagnosis: null as string | null,
          strategyLabel: "",
          notConfigured,
        };

      // Build MC return rates
      const simulationReturnRates: { label: string; rate: number }[] = [];
      for (
        let a = baseEngineInput.currentAge;
        a <= planEndAgeOf(baseEngineInput);
        a++
      ) {
        const allocations = interpolateAllocations(mcGlidePath, a);
        const blended = weightedGeometricRate(mcAssetClasses, allocations);
        simulationReturnRates.push({ label: `Age ${a}`, rate: blended });
      }

      const activeStrategy = readStoredStrategy(settings.withdrawalStrategy);
      const strategyMeta = getStrategyMeta(activeStrategy);
      const userStrategyParams = buildStrategyParams(settings);
      const activeParams = userStrategyParams[activeStrategy] ?? {};

      const classBuckets = await ctx.db.select().from(schema.assetClassBuckets);
      const simulationBaseEngineInput = {
        ...baseEngineInput,
        returnRates: simulationReturnRates,
        // VPW sizes by the stock share of the glide path this run uses.
        stockShareByAge:
          stockShareByAge(
            mcGlidePath,
            classifyAssetClasses(classBuckets),
            baseEngineInput.currentAge,
            planEndAgeOf(baseEngineInput),
          ) ?? undefined,
        ...saved,
        // buildDecumulationDefaults already resolves the active strategy and its
        // params, so no override is needed (unlike computeStrategyComparison).
        decumulationDefaults: buildDecumulationDefaults(
          settings,
          { withdrawalTaxPreference: {} },
          distributionTaxRates,
        ),
      };

      // --- Run baseline MC ---
      const baselineSimulation = await runMonteCarloOffThread({
        engineInput: simulationBaseEngineInput,
        numTrials: 200,
        seed: COMPARISON_SEED,
        assetClasses: mcAssetClasses,
        correlations: mcCorrelations,
        glidePath: mcGlidePath,
        inflationRisk: effectiveInflationRisk,
        returnClampMin: preset!.returnClampMin,
        returnClampMax: preset!.returnClampMax,
      });
      const baseline = {
        successRate: baselineSimulation.successRate,
        // The budget rate when computable, else the spending rate.
        stabilityRate:
          baselineSimulation.budgetStabilityRate ??
          baselineSimulation.spendingStabilityRate,
      };

      // --- Diagnose ---
      type DiagnosisGoal = "survival" | "smoothness" | "healthy";
      let primaryGoal: DiagnosisGoal = "healthy";
      if (baseline.successRate < SIMULATION_CONFIDENCE_THRESHOLD)
        primaryGoal = "survival";
      else if (baseline.stabilityRate < 0.5) primaryGoal = "smoothness";
      const targetMetric: "survival" | "smoothness" =
        primaryGoal === "healthy" ? "smoothness" : primaryGoal;

      // --- Select levers ---
      type Lever =
        | {
            kind: "strategyParam";
            key: string;
            label: string;
            delta: number;
            unit: "relative" | "absolute";
            currentValue: number;
          }
        | {
            kind: "global";
            field: string;
            label: string;
            delta: number;
            unit: "relative" | "absolute";
            currentValue: number;
          };

      const levers: Lever[] = [];

      // Strategy-specific levers from paramField.lever metadata
      for (const field of strategyMeta.paramFields) {
        if (!field.lever) continue;
        if (!field.lever.targets.includes(targetMetric)) continue;
        if (typeof field.default === "boolean") continue; // skip boolean params
        const currentValue =
          typeof activeParams[field.key] === "number"
            ? (activeParams[field.key] as number)
            : (field.default as number);
        levers.push({
          kind: "strategyParam",
          key: field.key,
          label: field.label,
          delta: field.lever.delta,
          unit: field.lever.unit,
          currentValue,
        });
      }

      // Baseline for the lever's `currentValue` and its delta below, not the possibly
      // stale household scalar (see resolveSsStartAgeBaseline).
      const ssStartAgeBaseline = resolveSsStartAgeBaseline(
        perPersonSettings,
        baseEngineInput.ssStartAge,
      );

      // Universal levers
      const universalLevers: {
        field: string;
        delta: number;
        unit: "relative" | "absolute";
        targets: readonly string[];
        label: string;
        currentValue: number;
        max: number;
      }[] = [
        {
          field: "retirementAge",
          delta: 2,
          unit: "absolute",
          targets: ["survival", "smoothness"],
          label: "Retirement Age",
          currentValue: planRetirementAgeOf(baseEngineInput),
          max: planEndAgeOf(baseEngineInput) - 5,
        },
        {
          field: "ssStartAge",
          delta: 3,
          unit: "absolute",
          targets: ["survival"],
          label: "SS Start Age",
          currentValue: ssStartAgeBaseline,
          max: 70,
        },
      ];
      for (const ul of universalLevers) {
        if (!ul.targets.includes(targetMetric)) continue;
        const adjusted = ul.currentValue + ul.delta;
        if (adjusted > ul.max || adjusted < 0) continue; // out of range
        levers.push({
          kind: "global",
          field: ul.field,
          label: ul.label,
          delta: ul.delta,
          unit: ul.unit,
          currentValue: ul.currentValue,
        });
      }

      // Cap at 6 scenarios
      const selectedLevers = levers.slice(0, 6);

      // --- Run what-if MC scenarios ---
      type Recommendation = {
        label: string;
        currentValue: string;
        adjustedValue: string;
        successRate: number;
        stabilityRate: number;
        successDelta: number;
        stabilityDelta: number;
      };

      const recommendations: Recommendation[] = [];
      for (const lever of selectedLevers) {
        const adjustedNum =
          lever.unit === "relative"
            ? lever.currentValue * (1 + lever.delta)
            : lever.currentValue + lever.delta;

        // Round to step size if strategy param
        let rounded = adjustedNum;
        if (lever.kind === "strategyParam") {
          const field = strategyMeta.paramFields.find(
            (f) => f.key === lever.key,
          );
          if (field?.step) {
            rounded = Math.round(adjustedNum / field.step) * field.step;
            rounded = Math.round(rounded * 10000) / 10000;
          }
          // Never past the range the field's own editor allows.
          if (field?.min != null) rounded = Math.max(field.min, rounded);
          if (field?.max != null) rounded = Math.min(field.max, rounded);
        }

        let variantInput = { ...simulationBaseEngineInput };
        if (lever.kind === "strategyParam") {
          const tweakedParams = {
            ...userStrategyParams,
            [activeStrategy]: {
              ...activeParams,
              [lever.key]: rounded,
            },
          };
          variantInput = {
            ...variantInput,
            decumulationDefaults: {
              ...variantInput.decumulationDefaults,
              strategyParams: tweakedParams,
            },
          };
        } else {
          // Global lever — modify the engine input field directly
          if (lever.field === "retirementAge") {
            // Everyone works the extra years. The payload is rebuilt with the later
            // ages, so every window tied to the retirement year moves with it.
            const shifted = await buildEnginePayload(ctx.db, data, {
              ...profiles,
              asOf: ctx.scope.asOf,
              retirementAgeDelta: rounded - lever.currentValue,
            });
            if (!shifted) continue;
            variantInput = {
              ...variantInput,
              ...shifted.baseEngineInput,
              returnRates: variantInput.returnRates,
              stockShareByAge: variantInput.stockShareByAge,
              accumulationOverrides: variantInput.accumulationOverrides,
              decumulationOverrides: variantInput.decumulationOverrides,
              decumulationDefaults: variantInput.decumulationDefaults,
            };
          } else if (lever.field === "ssStartAge") {
            // "Delay claiming by N years": shift every person's SS start age by the same
            // delta from `ssStartAgeBaseline` (not the possibly stale scalar) and
            // re-derive the benefit amounts.
            const delta = rounded - ssStartAgeBaseline;
            variantInput = { ...variantInput, ssStartAge: rounded };

            if (perPersonSettings.length > 1) {
              // Multi-person: the engine reads `socialSecurityEntries[].startAge`, not the
              // scalar, so rebuild the entries via the payload's own helper, keeping PIA
              // claiming-age adjustment and MFJ spousal math consistent with the baseline.
              variantInput = {
                ...variantInput,
                socialSecurityEntries: buildSocialSecurityEntries(
                  perPersonSettings,
                  payload.filingStatus,
                  delta,
                ),
              };
            } else {
              // Single-person: scalar path. A PIA benefit responds to claiming age
              // (delayed-retirement credits), so recompute it; a flat
              // `socialSecurityMonthly` doesn't.
              const solo = perPersonSettings[0];
              const soloPia = parseAnnualPia(solo?.socialSecurityPia);
              if (solo && soloPia != null) {
                variantInput = {
                  ...variantInput,
                  socialSecurityAnnual: computeAdjustedBenefit(
                    soloPia,
                    solo.birthYear,
                    rounded * 12,
                  ),
                };
              }
            }
          }
        }

        const variantSimulation = await runMonteCarloOffThread({
          engineInput: variantInput,
          numTrials: 200,
          seed: COMPARISON_SEED,
          assetClasses: mcAssetClasses,
          correlations: mcCorrelations,
          glidePath: mcGlidePath,
          inflationRisk: effectiveInflationRisk,
          returnClampMin: preset!.returnClampMin,
          returnClampMax: preset!.returnClampMax,
        });

        const variantStability =
          variantSimulation.budgetStabilityRate ??
          variantSimulation.spendingStabilityRate;

        // Format display values
        const formatVal = (v: number, l: Lever) => {
          if (
            l.kind === "global" &&
            (l.field === "retirementAge" || l.field === "ssStartAge")
          )
            return String(Math.round(v));
          // Strategy param — check field type
          const field = strategyMeta.paramFields.find(
            (f) => f.key === (l as { key: string }).key,
          );
          if (field?.type === "percent") return formatPercent(v, 1);
          if (field?.type === "number") return String(Math.round(v));
          return String(v);
        };

        recommendations.push({
          label: lever.label,
          currentValue: formatVal(lever.currentValue, lever),
          adjustedValue: formatVal(rounded, lever),
          successRate: variantSimulation.successRate,
          stabilityRate: variantStability,
          successDelta: variantSimulation.successRate - baseline.successRate,
          stabilityDelta: variantStability - baseline.stabilityRate,
        });
      }

      // Rank by improvement to primary goal, filter negligible, take top 3
      const scored = recommendations
        .map((r) => ({
          ...r,
          score:
            primaryGoal === "survival"
              ? r.successDelta * 2 + r.stabilityDelta
              : r.stabilityDelta * 2 + r.successDelta,
        }))
        .filter((r) => r.score > 0.02)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ score: _score, ...rest }) => rest);

      return {
        baseline: {
          successRate: baseline.successRate,
          stabilityRate: baseline.stabilityRate,
        },
        diagnosis: primaryGoal,
        strategyLabel: strategyMeta.label,
        recommendations: scored,
      };
    }),

  /** Persist MC asset class return/volatility overrides to appSettings. */
  updateAssetClassOverrides: scenarioProcedure
    .input(
      z.array(
        z.object({
          id: z.number(),
          meanReturn: z.number().optional(),
          stdDev: z.number().optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      const key = "mc_asset_class_overrides";
      if (input.length === 0) {
        await db
          .delete(schema.appSettings)
          .where(eq(schema.appSettings.key, key));
        return { updated: true, count: 0 };
      }
      await upsertSetting(db, key, input);
      return { updated: true, count: input.length };
    }),
});
