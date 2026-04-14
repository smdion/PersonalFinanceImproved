/**
 * Monte Carlo projection endpoint + related settings mutations.
 *
 * Contains the `computeMonteCarloProjection` query (the main stochastic
 * projection engine) and the three scenario-scoped mutations that edit
 * the MC input tables: `updateReturnRateTable`, `updateGlidePathAllocations`,
 * and `updateClampBounds`.
 *
 * Extracted from the old monolith `projection.ts` in PR 2b of the v0.5.2
 * file-split refactor. Pure relocation — no logic changes.
 */
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  scenarioProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { DEFAULT_WITHDRAWAL_RATE } from "@/lib/constants";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import {
  interpolateAllocations,
  geometricMean,
} from "@/lib/calculators/random";
import { toNumber } from "@/server/helpers";
import type {
  AccountBalance,
  AccountCategory,
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/calculators/types";
import {
  accountCategoryEnum,
  getAllCategories,
  getDefaultDecumulationOrder,
  isOverflowTarget,
  zeroBalance,
  DEFAULT_WITHDRAWAL_SPLITS as CONFIG_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  buildDecumulationDefaults,
} from "./_shared";

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
      z.object({
        numTrials: z.number().int().min(100).max(10000).default(1000),
        seed: z.number().int().optional(),
        /** Simulation preset: controls return assumptions, volatility, inflation risk, and trial count. */
        preset: z
          .enum(["aggressive", "default", "conservative", "custom"])
          .default("default"),
        /** Tax mode: 'simple' collapses to single tax-free balance (cFIREsim-comparable), 'advanced' uses full multi-account tax engine. */
        taxMode: z.enum(["simple", "advanced"]).default("simple"),
        // --- Optional contribution profile (overrides contribution accounts + salary) ---
        contributionProfileId: z.number().int().optional(),
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
        salaryOverrides: z
          .array(z.object({ personId: z.number(), salary: z.number() }))
          .optional(),

        // --- Decumulation defaults (mirrors getProjection) ---
        decumulationDefaults: z
          .object({
            withdrawalRate: z
              .number()
              .min(0)
              .max(1)
              .default(DEFAULT_WITHDRAWAL_RATE),
            withdrawalRoutingMode: z
              .enum(["bracket_filling", "waterfall", "percentage"])
              .default("bracket_filling"),
            withdrawalOrder: z
              .array(z.enum(accountCategoryEnum()))
              .default(getDefaultDecumulationOrder()),
            withdrawalSplits: z
              .record(z.enum(accountCategoryEnum()), z.number())
              .default({ ...CONFIG_WITHDRAWAL_SPLITS }),
            withdrawalTaxPreference: z
              .record(z.string(), z.enum(["traditional", "roth"]))
              .default({}),
          })
          .default({
            withdrawalRate: DEFAULT_WITHDRAWAL_RATE,
            withdrawalRoutingMode: "bracket_filling",
            withdrawalOrder: getDefaultDecumulationOrder(),
            withdrawalSplits: { ...CONFIG_WITHDRAWAL_SPLITS },
            withdrawalTaxPreference: {},
          }),

        // --- Accumulation overrides (mirrors getProjection) ---
        accumulationOverrides: accumulationOverrideSchema,

        // --- Decumulation overrides (mirrors getProjection) ---
        decumulationOverrides: decumulationOverrideSchema,

        // --- Phase-based budget selection (independent profile+column per phase) ---
        accumulationBudgetProfileId: z.number().int().optional(),
        accumulationBudgetColumn: z.number().int().min(0).optional(),
        /** Manual annual expense override for accumulation (bypasses budget profile). */
        accumulationExpenseOverride: z.number().min(0).optional(),
        decumulationBudgetProfileId: z.number().int().optional(),
        decumulationBudgetColumn: z.number().int().min(0).optional(),
        /** Manual annual expense override for decumulation (bypasses budget profile). */
        decumulationExpenseOverride: z.number().min(0).optional(),
        /** Optional inflation risk params. */
        inflationRisk: z
          .object({
            meanRate: z.number().min(0).max(0.2),
            stdDev: z.number().min(0).max(0.1),
          })
          .optional(),
        /** Optional snapshot ID — use a historical portfolio snapshot instead of the latest. */
        snapshotId: z.number().int().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Fetch shared data + MC-specific tables + saved overrides in parallel
      const [
        data,
        assetClasses,
        assetCorrelations,
        glidePathRows,
        savedAssetOverridesRow,
        savedInflationOverridesRow,
      ] = await Promise.all([
        fetchRetirementData(ctx.db, { snapshotId: input.snapshotId }),
        ctx.db
          .select()
          .from(schema.assetClassParams)
          .where(eq(schema.assetClassParams.isActive, true))
          .orderBy(asc(schema.assetClassParams.sortOrder)),
        ctx.db.select().from(schema.assetClassCorrelations),
        ctx.db.select().from(schema.glidePathAllocations),
        ctx.db
          .select({ value: schema.appSettings.value })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, "mc_asset_class_overrides"))
          .then((r) => r[0] ?? null),
        ctx.db
          .select({ value: schema.appSettings.value })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, "mc_inflation_overrides"))
          .then((r) => r[0] ?? null),
      ]);

      // Merge saved overrides: UI-provided overrides take priority over DB-saved ones
      const savedAssetOverrides = (savedAssetOverridesRow?.value ?? []) as {
        id: number;
        meanReturn?: number;
        stdDev?: number;
      }[];
      const savedInflationOverrides = (savedInflationOverridesRow?.value ??
        null) as { meanRate?: number; stdDev?: number } | null;

      const payload = await buildEnginePayload(ctx.db, data, {
        salaryOverrides: input.salaryOverrides,
        contributionProfileId: input.contributionProfileId,
        accumulationBudgetProfileId: input.accumulationBudgetProfileId,
        accumulationBudgetColumn: input.accumulationBudgetColumn,
        accumulationExpenseOverride: input.accumulationExpenseOverride,
        decumulationBudgetProfileId: input.decumulationBudgetProfileId,
        decumulationBudgetColumn: input.decumulationBudgetColumn,
        decumulationExpenseOverride: input.decumulationExpenseOverride,
      });
      if (!payload)
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
        avgRetirementAge,
        maxEndAge,
        totalCompensation,
        portfolioByTaxType,
        employerMatchByCategory,
        selectedScenario: _selectedScenario,
        totalRealContrib,
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
        accumulationOverrides:
          input.accumulationOverrides as AccumulationOverride[],
        decumulationOverrides:
          input.decumulationOverrides as DecumulationOverride[],
      };

      // Simple tax mode: collapse all balances into a single tax-free portfolio (cFIREsim-comparable)
      if (input.taxMode === "simple") {
        const totalBalance =
          portfolioByTaxType.preTax +
          portfolioByTaxType.taxFree +
          portfolioByTaxType.hsa +
          portfolioByTaxType.afterTax;

        engineInput.startingBalances = {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: totalBalance,
          afterTaxBasis: totalBalance,
        };

        // Zero all account balances, put totalBalance in the overflow target (brokerage)
        const simplifiedBalances = Object.fromEntries(
          getAllCategories().map((cat) => {
            if (isOverflowTarget(cat)) {
              return [
                cat,
                {
                  structure: "basis_tracking" as const,
                  balance: totalBalance,
                  basis: totalBalance,
                },
              ];
            }
            return [cat, zeroBalance(cat)];
          }),
        ) as Record<AccountCategory, AccountBalance>;
        engineInput.startingAccountBalances = simplifiedBalances;

        engineInput.decumulationDefaults.distributionTaxRates = {
          ...engineInput.decumulationDefaults.distributionTaxRates,
          traditionalFallbackRate: 0,
          roth: 0,
          hsa: 0,
          brokerage: 0,
          grossUpForTaxes: false,
        };
      }

      // ----- Monte Carlo: Fetch preset from DB -----
      const isCustom = input.preset === "custom";

      // Fetch preset row + its glide path + return overrides from DB
      const [presetRows, presetGpRows, presetRoRows] = await Promise.all([
        isCustom
          ? Promise.resolve([])
          : ctx.db
              .select()
              .from(schema.mcPresets)
              .where(eq(schema.mcPresets.key, input.preset)),
        isCustom
          ? Promise.resolve([])
          : ctx.db
              .execute<{
                preset_key: string;
                age: number;
                asset_class_id: number;
                class_name: string;
                allocation: string;
              }>(
                sql`SELECT p.key AS preset_key, gp.age, gp.asset_class_id, ac.name AS class_name, gp.allocation
                  FROM mc_preset_glide_paths gp
                  JOIN mc_presets p ON p.id = gp.preset_id
                  JOIN asset_class_params ac ON ac.id = gp.asset_class_id
                  WHERE p.key = ${input.preset}
                  ORDER BY gp.age, ac.sort_order`,
              )
              .then((r) => r.rows),
        isCustom
          ? Promise.resolve([])
          : ctx.db
              .execute<{
                asset_class_id: number;
                class_name: string;
                mean_return: string;
              }>(
                sql`SELECT ro.asset_class_id, ac.name AS class_name, ro.mean_return
                  FROM mc_preset_return_overrides ro
                  JOIN mc_presets p ON p.id = ro.preset_id
                  JOIN asset_class_params ac ON ac.id = ro.asset_class_id
                  WHERE p.key = ${input.preset}`,
              )
              .then((r) => r.rows),
      ]);

      const preset = presetRows[0] ?? null;

      // Build override lookups: DB-saved overrides as base, UI overrides on top
      const effectiveAssetOverrides = [...savedAssetOverrides];
      for (const uiOvr of input.assetClassOverrides ?? []) {
        const idx = effectiveAssetOverrides.findIndex((o) => o.id === uiOvr.id);
        if (idx >= 0) effectiveAssetOverrides[idx] = uiOvr;
        else effectiveAssetOverrides.push(uiOvr);
      }
      const overrideById = new Map(
        effectiveAssetOverrides.map((o) => [o.id, o]),
      );
      const returnOverrideById = new Map(
        presetRoRows.map((ro) => [ro.asset_class_id, toNumber(ro.mean_return)]),
      );
      const hasReturnOverrides = returnOverrideById.size > 0;

      // Validate asset class override IDs match DB
      if (input.assetClassOverrides) {
        const activeIds = new Set(assetClasses.map((ac) => ac.id));
        for (const override of input.assetClassOverrides) {
          if (!activeIds.has(override.id)) {
            throw new Error(
              `Asset class override id '${override.id}' does not match any active asset class`,
            );
          }
        }
      }

      // Build MC-specific inputs: UI overrides > preset return overrides > preset multiplier > DB values
      const returnMultiplier = preset ? toNumber(preset.returnMultiplier) : 1.0;
      const volMultiplier = preset ? toNumber(preset.volMultiplier) : 1.0;

      const mcAssetClasses = assetClasses.map((ac) => {
        const dbReturn = toNumber(ac.meanReturn);
        const dbStdDev = toNumber(ac.stdDev);
        const uiOverride = overrideById.get(ac.id);
        return {
          id: ac.id,
          name: ac.name,
          meanReturn:
            uiOverride?.meanReturn ??
            (hasReturnOverrides
              ? (returnOverrideById.get(ac.id) ??
                dbReturn * (returnMultiplier || 0.5))
              : isCustom
                ? dbReturn
                : dbReturn * returnMultiplier),
          stdDev:
            uiOverride?.stdDev ??
            (isCustom ? dbStdDev : dbStdDev * volMultiplier),
        };
      });

      const mcCorrelations = assetCorrelations.map((c) => ({
        classAId: c.classAId,
        classBId: c.classBId,
        correlation: toNumber(c.correlation),
      }));

      // Glide path: DB preset for named presets, glide_path_allocations for custom
      let mcGlidePath: { age: number; allocations: Record<number, number> }[];
      if (!isCustom && presetGpRows.length > 0) {
        // Build from mc_preset_glide_paths
        const gpByAge = new Map<number, Record<number, number>>();
        for (const row of presetGpRows) {
          if (!gpByAge.has(row.age)) gpByAge.set(row.age, {});
          gpByAge.get(row.age)![row.asset_class_id] = toNumber(row.allocation);
        }
        mcGlidePath = Array.from(gpByAge.entries())
          .sort(([a], [b]) => a - b)
          .map(([gpAge, allocations]) => ({ age: gpAge, allocations }));
      } else {
        // Custom: build from glide_path_allocations table
        const gpByAge = new Map<number, Record<number, number>>();
        for (const gp of glidePathRows) {
          if (!gpByAge.has(gp.age)) gpByAge.set(gp.age, {});
          gpByAge.get(gp.age)![gp.assetClassId] = toNumber(gp.allocation);
        }
        mcGlidePath = Array.from(gpByAge.entries())
          .sort(([a], [b]) => a - b)
          .map(([gpAge, allocations]) => ({ age: gpAge, allocations }));
      }

      // Resolve effective inflation risk: explicit UI override > saved DB overrides > preset DB values > fallback
      const baseInflationRisk = preset
        ? {
            meanRate: toNumber(preset.inflationMean),
            stdDev: toNumber(preset.inflationStdDev),
          }
        : { meanRate: 0.025, stdDev: 0.012 };
      const effectiveInflationRisk =
        input.inflationRisk ??
        (savedInflationOverrides
          ? {
              meanRate:
                savedInflationOverrides.meanRate ?? baseInflationRisk.meanRate,
              stdDev:
                savedInflationOverrides.stdDev ?? baseInflationRisk.stdDev,
            }
          : null) ??
        baseInflationRisk;

      // Resolve return clamp bounds from preset (or defaults)
      const returnClampMin = preset ? toNumber(preset.returnClampMin) : -0.5;
      const returnClampMax = preset ? toNumber(preset.returnClampMax) : 1.0;

      // Build MC-aligned deterministic return rates using GEOMETRIC means.
      // The arithmetic mean is the expected single-year return, but deterministic compounding
      // should use the geometric mean (median compounding rate) to avoid overstating growth.
      // The MC stochastic trials naturally produce geometric compounding through randomization.
      const mcDeterministicRates: { label: string; rate: number }[] = [];
      for (
        let a = engineInput.currentAge;
        a <= engineInput.projectionEndAge;
        a++
      ) {
        const allocations = interpolateAllocations(mcGlidePath, a);
        const blended = mcAssetClasses.reduce((sum, ac) => {
          const w = allocations[ac.id] ?? 0;
          return w > 0
            ? sum + w * geometricMean(ac.meanReturn, ac.stdDev)
            : sum;
        }, 0);
        mcDeterministicRates.push({ label: `Age ${a}`, rate: blended });
      }
      const mcEngineInput = {
        ...engineInput,
        returnRates: mcDeterministicRates,
      };

      const result = calculateMonteCarlo({
        engineInput: mcEngineInput,
        numTrials: input.numTrials,
        seed: input.seed,
        assetClasses: mcAssetClasses,
        correlations: mcCorrelations,
        glidePath: mcGlidePath,
        inflationRisk: effectiveInflationRisk,
        returnClampMin,
        returnClampMax,
      });

      // Build current glide path allocation for display (interpolate at current age)
      const currentGpEntry =
        mcGlidePath.find((gp) => gp.age >= age) ?? mcGlidePath[0];

      // Compute blended portfolio return/vol for display (geometric mean = realistic compounding rate)
      const currentAlloc = currentGpEntry?.allocations ?? {};
      const blendedReturn = mcAssetClasses.reduce((sum, ac) => {
        const w = currentAlloc[ac.id] ?? 0;
        return w > 0 ? sum + w * geometricMean(ac.meanReturn, ac.stdDev) : sum;
      }, 0);
      const blendedVol = mcAssetClasses.reduce(
        (sum, ac) => sum + ac.stdDev * (currentAlloc[ac.id] ?? 0),
        0,
      );

      // Build DB (raw) asset class values for comparison
      const dbAssetClasses = assetClasses.map((ac) => ({
        id: ac.id,
        name: ac.name,
        meanReturn: toNumber(ac.meanReturn),
        stdDev: toNumber(ac.stdDev),
      }));

      return {
        result,
        simulationInputs: {
          currentAge: age,
          retirementAge: avgRetirementAge,
          endAge: maxEndAge,
          startingBalance:
            portfolioByTaxType.preTax +
            portfolioByTaxType.taxFree +
            portfolioByTaxType.hsa +
            portfolioByTaxType.afterTax,
          annualContributions:
            totalRealContrib +
            Object.values(employerMatchByCategory).reduce((s, v) => s + v, 0),
          annualExpenses: annualExpensesVal,
          inflationRate: toNumber(settings.annualInflation),
          salary: totalCompensation,
          assetClasses: mcAssetClasses,
          dbAssetClasses,
          currentAllocation: currentAlloc,
          glidePathAges: mcGlidePath.map((gp) => gp.age),
          glidePath: mcGlidePath,
          preset: input.preset,
          presetLabel: preset?.label ?? "Custom",
          presetDescription:
            preset?.description ??
            "Raw DB values — no preset adjustments applied",
          blendedReturn,
          blendedVol,
          inflationRisk: effectiveInflationRisk,
          withdrawalRate: toNumber(settings.withdrawalRate),
          withdrawalStrategy: settings.withdrawalStrategy ?? "fixed",
          decumulationExpenseOverride: input.decumulationExpenseOverride,
          accumulationExpenseOverride: input.accumulationExpenseOverride,
          taxMode: input.taxMode,
          hasAssetClassOverrides: effectiveAssetOverrides.length > 0,
          hasSalaryOverrides: (input.salaryOverrides ?? []).length > 0,
          correlations: mcCorrelations,
          returnClampMin,
          returnClampMax,
          returnMultiplier,
          volMultiplier,
        },
        savedOverrides: {
          assetClassOverrides: savedAssetOverrides,
          inflationOverrides: savedInflationOverrides,
        },
      };
    }),

  // --- Mutations for editing projection assumptions ---

  updateReturnRateTable: scenarioProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({ age: z.number().int(), rateOfReturn: z.number() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      for (const entry of input.entries) {
        await db
          .insert(schema.returnRateTable)
          .values({ age: entry.age, rateOfReturn: String(entry.rateOfReturn) })
          .onConflictDoUpdate({
            target: schema.returnRateTable.age,
            set: { rateOfReturn: String(entry.rateOfReturn) },
          });
      }
      return { updated: input.entries.length };
    }),

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
        returnClampMin: z.number(),
        returnClampMax: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      await db
        .update(schema.mcPresets)
        .set({
          returnClampMin: String(input.returnClampMin),
          returnClampMax: String(input.returnClampMax),
        })
        .where(eq(schema.mcPresets.key, input.preset));
      return { updated: true };
    }),
});
