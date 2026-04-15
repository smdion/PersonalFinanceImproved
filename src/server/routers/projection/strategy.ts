/**
 * Withdrawal strategy comparison + analyzer endpoints, plus the
 * strategy-adjacent settings mutations.
 *
 * Contains:
 * - `computeStrategyComparison` — runs calculateProjection() for each
 *   strategy varying only withdrawalStrategy + strategyParams.
 * - `analyzeStrategy` — runs what-if MC scenarios on the active strategy
 *   and returns ranked recommendations.
 * - `updateInflationRisk` — persists MC preset inflation params.
 * - `updateAssetClassOverrides` — persists user asset class return/vol
 *   overrides to appSettings.
 *
 * Extracted from the old monolith `projection.ts` in PR 2b of the v0.5.2
 * file-split refactor. Pure relocation — no logic changes.
 */
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  scenarioProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { calculateProjection } from "@/lib/calculators/engine";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import {
  interpolateAllocations,
  geometricMean,
} from "@/lib/calculators/random";
import { formatPercent } from "@/lib/utils/format";
import { toNumber } from "@/server/helpers";
import type { AccountCategory } from "@/lib/calculators/types";
import {
  getDefaultDecumulationOrder,
  DEFAULT_WITHDRAWAL_SPLITS as CONFIG_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import { roundToCents } from "@/lib/utils/math";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import {
  getAllStrategyKeys,
  getStrategyMeta,
  getStrategyDefaults,
} from "@/lib/config/withdrawal-strategies";
import { buildStrategyParams, buildMcInputs } from "./_shared";

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
        .object({
          salaryOverrides: z
            .array(z.object({ personId: z.number(), salary: z.number() }))
            .optional(),
          contributionProfileId: z.number().int().optional(),
          decumulationBudgetProfileId: z.number().int().optional(),
          decumulationBudgetColumn: z.number().int().min(0).optional(),
          decumulationExpenseOverride: z.number().min(0).optional(),
          accumulationBudgetProfileId: z.number().int().optional(),
          accumulationBudgetColumn: z.number().int().min(0).optional(),
          accumulationExpenseOverride: z.number().min(0).optional(),
          snapshotId: z.number().int().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const [
        data,
        { mcAssetClasses, mcCorrelations, mcGlidePath, effectiveInflationRisk },
      ] = await Promise.all([
        fetchRetirementData(ctx.db, { snapshotId: input?.snapshotId }),
        buildMcInputs(ctx.db),
      ]);

      const payload = await buildEnginePayload(ctx.db, data, {
        salaryOverrides: input?.salaryOverrides,
        contributionProfileId: input?.contributionProfileId,
        accumulationBudgetProfileId: input?.accumulationBudgetProfileId,
        accumulationBudgetColumn: input?.accumulationBudgetColumn,
        accumulationExpenseOverride: input?.accumulationExpenseOverride,
        decumulationBudgetProfileId: input?.decumulationBudgetProfileId,
        decumulationBudgetColumn: input?.decumulationBudgetColumn,
        decumulationExpenseOverride: input?.decumulationExpenseOverride,
      });
      if (!payload) return { strategies: [], activeStrategy: null };

      const {
        settings,
        distributionTaxRates,
        baseEngineInput,
        avgRetirementAge,
      } = payload;

      // Build MC-aligned deterministic return rates using geometric means
      const mcReturnRates: { label: string; rate: number }[] = [];
      for (
        let a = baseEngineInput.currentAge;
        a <= baseEngineInput.projectionEndAge;
        a++
      ) {
        const allocations = interpolateAllocations(mcGlidePath, a);
        const blended = mcAssetClasses.reduce((sum, ac) => {
          const w = allocations[ac.id] ?? 0;
          return w > 0
            ? sum + w * geometricMean(ac.meanReturn, ac.stdDev)
            : sum;
        }, 0);
        mcReturnRates.push({ label: `Age ${a}`, rate: blended });
      }
      const mcBaseEngineInput = {
        ...baseEngineInput,
        returnRates: mcReturnRates,
      };
      const hasMcData = mcAssetClasses.length > 0 && mcGlidePath.length > 0;

      const userStrategyParams = buildStrategyParams(settings);
      const activeStrategy =
        (settings.withdrawalStrategy as WithdrawalStrategyType) ?? "fixed";

      const strategies = getAllStrategyKeys().map((strategyKey) => {
        const meta = getStrategyMeta(strategyKey);
        // Use user-configured params for the active strategy, defaults for others
        const params =
          strategyKey === activeStrategy
            ? userStrategyParams
            : { [strategyKey]: getStrategyDefaults(strategyKey) };

        const decumulationDefaults = {
          withdrawalRate: toNumber(settings.withdrawalRate),
          withdrawalRoutingMode: "bracket_filling" as const,
          withdrawalOrder: getDefaultDecumulationOrder() as AccountCategory[],
          withdrawalSplits: { ...CONFIG_WITHDRAWAL_SPLITS } as Record<
            AccountCategory,
            number
          >,
          withdrawalTaxPreference: {},
          distributionTaxRates,
          withdrawalStrategy: strategyKey,
          strategyParams: params,
        };

        const result = calculateProjection({
          ...baseEngineInput,
          decumulationDefaults,
          accumulationOverrides: [],
          decumulationOverrides: [],
        });

        // Extract decumulation years for year-by-year data
        const decYears = result.projectionByYear.filter(
          (y): y is Extract<typeof y, { phase: "decumulation" }> =>
            y.phase === "decumulation",
        );

        const withdrawals = decYears.map((y) => y.totalWithdrawal);
        const avgWithdrawal =
          withdrawals.length > 0
            ? withdrawals.reduce((s, w) => s + w, 0) / withdrawals.length
            : 0;

        // Run lightweight MC (200 trials) for success rate + spending stability
        let successRate: number | null = null;
        let spendingStabilityRate: number | null = null;
        let budgetStabilityRate: number | null = null;
        if (hasMcData) {
          const mcResult = calculateMonteCarlo({
            engineInput: {
              ...mcBaseEngineInput,
              decumulationDefaults,
              accumulationOverrides: [],
              decumulationOverrides: [],
            },
            numTrials: 200,
            seed: 42,
            assetClasses: mcAssetClasses,
            correlations: mcCorrelations,
            glidePath: mcGlidePath,
            inflationRisk: effectiveInflationRisk,
          });
          successRate = mcResult.successRate;
          spendingStabilityRate = mcResult.spendingStabilityRate;
          budgetStabilityRate = mcResult.budgetStabilityRate;
        }

        return {
          strategy: strategyKey,
          label: meta.label,
          shortLabel: meta.shortLabel,
          portfolioDepletionAge: result.portfolioDepletionAge,
          sustainableWithdrawal: result.sustainableWithdrawal,
          year1Withdrawal: decYears[0]?.totalWithdrawal ?? 0,
          avgAnnualWithdrawal: roundToCents(avgWithdrawal),
          minAnnualWithdrawal:
            withdrawals.length > 0 ? roundToCents(Math.min(...withdrawals)) : 0,
          maxAnnualWithdrawal:
            withdrawals.length > 0 ? roundToCents(Math.max(...withdrawals)) : 0,
          endBalance:
            decYears.length > 0 ? decYears[decYears.length - 1]!.endBalance : 0,
          legacyAmount:
            decYears.length > 0 ? decYears[decYears.length - 1]!.endBalance : 0,
          successRate,
          spendingStabilityRate,
          budgetStabilityRate,
          yearByYear: decYears.map((y) => ({
            age: y.age,
            withdrawal: roundToCents(y.totalWithdrawal),
            endBalance: roundToCents(y.endBalance),
          })),
        };
      });

      return {
        strategies,
        activeStrategy,
        retirementAge: avgRetirementAge,
      };
    }),

  /** Analyze the active strategy — run what-if MC scenarios and return ranked recommendations. */
  analyzeStrategy: protectedProcedure
    .input(
      z
        .object({
          salaryOverrides: z
            .array(z.object({ personId: z.number(), salary: z.number() }))
            .optional(),
          contributionProfileId: z.number().int().optional(),
          accumulationBudgetProfileId: z.number().int().optional(),
          accumulationBudgetColumn: z.number().int().min(0).optional(),
          accumulationExpenseOverride: z.number().min(0).optional(),
          decumulationBudgetProfileId: z.number().int().optional(),
          decumulationBudgetColumn: z.number().int().min(0).optional(),
          decumulationExpenseOverride: z.number().min(0).optional(),
          snapshotId: z.number().int().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const [
        data,
        { mcAssetClasses, mcCorrelations, mcGlidePath, effectiveInflationRisk },
      ] = await Promise.all([
        fetchRetirementData(ctx.db, { snapshotId: input?.snapshotId }),
        buildMcInputs(ctx.db),
      ]);

      const payload = await buildEnginePayload(ctx.db, data, {
        salaryOverrides: input?.salaryOverrides,
        contributionProfileId: input?.contributionProfileId,
        accumulationBudgetProfileId: input?.accumulationBudgetProfileId,
        accumulationBudgetColumn: input?.accumulationBudgetColumn,
        accumulationExpenseOverride: input?.accumulationExpenseOverride,
        decumulationBudgetProfileId: input?.decumulationBudgetProfileId,
        decumulationBudgetColumn: input?.decumulationBudgetColumn,
        decumulationExpenseOverride: input?.decumulationExpenseOverride,
      });
      if (!payload)
        return {
          baseline: null,
          recommendations: [],
          diagnosis: null as string | null,
          strategyLabel: "",
        };

      const { settings, distributionTaxRates, baseEngineInput } = payload;

      if (mcAssetClasses.length === 0 || mcGlidePath.length === 0)
        return {
          baseline: null,
          recommendations: [],
          diagnosis: null as string | null,
          strategyLabel: "",
        };

      // Build MC return rates
      const mcReturnRates: { label: string; rate: number }[] = [];
      for (
        let a = baseEngineInput.currentAge;
        a <= baseEngineInput.projectionEndAge;
        a++
      ) {
        const allocations = interpolateAllocations(mcGlidePath, a);
        const blended = mcAssetClasses.reduce((sum, ac) => {
          const w = allocations[ac.id] ?? 0;
          return w > 0
            ? sum + w * geometricMean(ac.meanReturn, ac.stdDev)
            : sum;
        }, 0);
        mcReturnRates.push({ label: `Age ${a}`, rate: blended });
      }

      const activeStrategy =
        (settings.withdrawalStrategy as WithdrawalStrategyType) ?? "fixed";
      const strategyMeta = getStrategyMeta(activeStrategy);
      const userStrategyParams = buildStrategyParams(settings);
      const activeParams = userStrategyParams[activeStrategy] ?? {};

      const mcBaseEngineInput = {
        ...baseEngineInput,
        returnRates: mcReturnRates,
        accumulationOverrides: [] as [],
        decumulationOverrides: [] as [],
        decumulationDefaults: {
          withdrawalRate: toNumber(settings.withdrawalRate),
          withdrawalRoutingMode: "bracket_filling" as const,
          withdrawalOrder: getDefaultDecumulationOrder() as AccountCategory[],
          withdrawalSplits: { ...CONFIG_WITHDRAWAL_SPLITS } as Record<
            AccountCategory,
            number
          >,
          withdrawalTaxPreference: {},
          distributionTaxRates,
          withdrawalStrategy: activeStrategy,
          strategyParams: userStrategyParams,
        },
      };

      // --- Run baseline MC ---
      const baselineMc = calculateMonteCarlo({
        engineInput: mcBaseEngineInput,
        numTrials: 200,
        seed: 42,
        assetClasses: mcAssetClasses,
        correlations: mcCorrelations,
        glidePath: mcGlidePath,
        inflationRisk: effectiveInflationRisk,
      });
      const baseline = {
        successRate: baselineMc.successRate,
        stabilityRate:
          baselineMc.budgetStabilityRate ?? baselineMc.spendingStabilityRate,
      };

      // --- Diagnose ---
      type DiagnosisGoal = "survival" | "smoothness" | "healthy";
      let primaryGoal: DiagnosisGoal = "healthy";
      if (baseline.successRate < 0.9) primaryGoal = "survival";
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
          currentValue: baseEngineInput.retirementAge,
          max: baseEngineInput.projectionEndAge - 5,
        },
        {
          field: "withdrawalRate",
          delta: -0.005,
          unit: "absolute",
          targets: ["survival"],
          label: "Withdrawal Rate",
          currentValue: toNumber(settings.withdrawalRate),
          max: 1,
        },
        {
          field: "ssStartAge",
          delta: 3,
          unit: "absolute",
          targets: ["survival"],
          label: "SS Start Age",
          currentValue: baseEngineInput.ssStartAge,
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
        }

        // Build variant engine input
        let variantInput = { ...mcBaseEngineInput };
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
            variantInput = { ...variantInput, retirementAge: rounded };
          } else if (lever.field === "withdrawalRate") {
            variantInput = {
              ...variantInput,
              decumulationDefaults: {
                ...variantInput.decumulationDefaults,
                withdrawalRate: rounded,
              },
            };
          } else if (lever.field === "ssStartAge") {
            variantInput = { ...variantInput, ssStartAge: rounded };
          }
        }

        const variantMc = calculateMonteCarlo({
          engineInput: variantInput,
          numTrials: 200,
          seed: 42,
          assetClasses: mcAssetClasses,
          correlations: mcCorrelations,
          glidePath: mcGlidePath,
          inflationRisk: effectiveInflationRisk,
        });

        const variantStability =
          variantMc.budgetStabilityRate ?? variantMc.spendingStabilityRate;

        // Format display values
        const formatVal = (v: number, l: Lever) => {
          if (
            l.kind === "global" &&
            (l.field === "retirementAge" || l.field === "ssStartAge")
          )
            return String(Math.round(v));
          if (l.kind === "global" && l.field === "withdrawalRate")
            return formatPercent(v, 2);
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
          successRate: variantMc.successRate,
          stabilityRate: variantStability,
          successDelta: variantMc.successRate - baseline.successRate,
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

  updateInflationRisk: scenarioProcedure
    .input(
      z.object({
        preset: z.enum(["aggressive", "default", "conservative", "custom"]),
        inflationMean: z.number(),
        inflationStdDev: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      const key = "mc_inflation_overrides";
      const value = {
        meanRate: input.inflationMean,
        stdDev: input.inflationStdDev,
      };
      await db
        .insert(schema.appSettings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value },
        });
      return { updated: true };
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
      await db
        .insert(schema.appSettings)
        .values({ key, value: input })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: input },
        });
      return { updated: true, count: input.length };
    }),
});
