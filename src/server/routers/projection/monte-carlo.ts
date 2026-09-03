/**
 * Monte Carlo projection endpoint + related settings mutations.
 *
 * Contains the `computeMonteCarloProjection` query (the main stochastic
 * projection engine) and the three scenario-scoped mutations that edit
 * the MC input tables: `updateReturnRateTable`, `updateGlidePathAllocations`,
 * and `updateClampBounds`.
 */
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { queryRaw } from "@/lib/db/compat";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  scenarioProcedure,
  adminProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
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
import {
  DEFAULT_MC_INFLATION_RISK,
  MC_RETURN_CLAMP_MIN,
  MC_RETURN_CLAMP_MAX,
} from "@/lib/constants";
import type {
  AccountBalance,
  AccountCategory,
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/calculators/types";
import {
  getAllCategories,
  isOverflowTarget,
  zeroBalance,
} from "@/lib/config/account-types";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  decumulationDefaultsInputSchema,
  buildDecumulationDefaults,
  buildMcInputs,
} from "./_shared";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
  generateSeed,
  clearProjectionCache,
} from "@/server/helpers/projection-cache";

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
        /** Optional Salary Profile — the independent "what if I earned X" axis. */
        salaryProfileId: z.number().int().optional(),
        /** View a non-active Retirement Profile (phase 4 assumptions band) —
         *  same "view without activating" contract as the two profile ids
         *  above. Falls back to the household's globally-active profile
         *  when omitted. Advisor-caught 2026-09-01: getProjection/
         *  computeStrategyComparison already accepted this; the Monte
         *  Carlo query (this endpoint) never did, so the AssumptionsBand's
         *  "view a non-active profile" never reached the chart/table it
         *  sits directly above — silently kept showing the globally-active
         *  profile's numbers regardless of what the band was viewing. */
        retirementProfileId: z.number().int().optional(),
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
        salaryActiveFields: z
          .array(z.object({ personId: z.number(), salary: z.number() }))
          .optional(),

        // --- Decumulation defaults (mirrors getProjection) ---
        decumulationDefaults: decumulationDefaultsInputSchema,

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
      // Fetch shared data + MC-specific tables + saved overrides in parallel
      const [
        data,
        {
          mcAssetClasses: baseMcAssetClasses,
          mcCorrelations,
          mcGlidePath: baseGlidePath,
          savedInflationOverrides,
        },
        savedAssetOverridesRow,
      ] = await Promise.all([
        fetchRetirementData(ctx.db, {
          snapshotId: input.snapshotId,
          contributionProfileId: input.contributionProfileId,
          salaryProfileId: input.salaryProfileId,
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
        salaryActiveFields: input.salaryActiveFields,
        contributionProfileId: input.contributionProfileId,
        salaryProfileId: input.salaryProfileId,
        accumulationBudgetProfileId: input.accumulationBudgetProfileId,
        accumulationBudgetColumn: input.accumulationBudgetColumn,
        accumulationExpenseOverride: input.accumulationExpenseOverride,
        decumulationBudgetProfileId: input.decumulationBudgetProfileId,
        decumulationBudgetColumn: input.decumulationBudgetColumn,
        decumulationExpenseOverride: input.decumulationExpenseOverride,
        retirementProfileId: input.retirementProfileId,
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
        rateSeededDecumulationYear1: input.rateSeededDecumulationYear1,
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

        // Simple mode discards tax-type/account identity for the AGGREGATE
        // math above — `individualAccounts` must follow suit rather than
        // keeping each account's real balance around. Leaving it real
        // while the aggregate is fictional doesn't just risk a stale
        // display: withdrawals only ever route against the collapsed
        // brokerage category, so a real Traditional/IRA account never gets
        // drawn down in decumulation while the real brokerage account gets
        // exhausted, and the per-account total silently overstates the
        // real portfolio (advisor review, 2026-08-28, after a live-user
        // finding — a partial fix that only skipped the yearly indBal/
        // acctBal reconciliation stopped the correction but not this
        // divergence). Dropping individualAccounts to empty makes Simple
        // mode's ONE fictional bucket the only representation, so nothing
        // downstream can disagree with it. The per-account table/chart and
        // the person-filtered ("Sean"/"Joanna") view both already degrade
        // gracefully when there's no individual data (see
        // ProjectionCard's disabled-pill guard + reconcileIndividualToAggregate's
        // existing `hasIndividualAccounts` gate) — no engine-level flag
        // needed.
        engineInput.individualAccounts = [];
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
          : queryRaw<{
              preset_key: string;
              age: number;
              asset_class_id: number;
              class_name: string;
              allocation: string;
            }>(
              ctx.db,
              sql`SELECT p.key AS preset_key, gp.age, gp.asset_class_id, ac.name AS class_name, gp.allocation
                  FROM mc_preset_glide_paths gp
                  JOIN mc_presets p ON p.id = gp.preset_id
                  JOIN asset_class_params ac ON ac.id = gp.asset_class_id
                  WHERE p.key = ${input.preset}
                  ORDER BY gp.age, ac.sort_order`,
            ),
        isCustom
          ? Promise.resolve([])
          : queryRaw<{
              asset_class_id: number;
              class_name: string;
              mean_return: string;
            }>(
              ctx.db,
              sql`SELECT ro.asset_class_id, ac.name AS class_name, ro.mean_return
                  FROM mc_preset_return_overrides ro
                  JOIN mc_presets p ON p.id = ro.preset_id
                  JOIN asset_class_params ac ON ac.id = ro.asset_class_id
                  WHERE p.key = ${input.preset}`,
            ),
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
        const activeIds = new Set(baseMcAssetClasses.map((ac) => ac.id));
        for (const override of input.assetClassOverrides) {
          if (!activeIds.has(override.id)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Asset class override id '${override.id}' does not match any active asset class`,
            });
          }
        }
      }

      // Build MC-specific inputs: UI overrides > preset return overrides > preset multiplier > DB values
      const returnMultiplier = preset ? toNumber(preset.returnMultiplier) : 1.0;
      const volMultiplier = preset ? toNumber(preset.volMultiplier) : 1.0;

      const mcAssetClasses = baseMcAssetClasses.map((ac) => {
        const dbReturn = ac.meanReturn;
        const dbStdDev = ac.stdDev;
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
        // Custom: use glide_path_allocations already fetched by buildMcInputs
        mcGlidePath = baseGlidePath;
      }

      // Resolve effective inflation risk: explicit UI override > saved DB overrides > preset DB values > fallback
      const baseInflationRisk = preset
        ? {
            meanRate: toNumber(preset.inflationMean),
            stdDev: toNumber(preset.inflationStdDev),
          }
        : DEFAULT_MC_INFLATION_RISK;
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
      const returnClampMin = preset
        ? toNumber(preset.returnClampMin)
        : MC_RETURN_CLAMP_MIN;
      const returnClampMax = preset
        ? toNumber(preset.returnClampMax)
        : MC_RETURN_CLAMP_MAX;

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
        const blended = sumBy(mcAssetClasses, (ac) => {
          const w = allocations[ac.id] ?? 0;
          return w > 0 ? w * geometricMean(ac.meanReturn, ac.stdDev) : 0;
        });
        mcDeterministicRates.push({ label: `Age ${a}`, rate: blended });
      }
      const mcEngineInput = {
        ...engineInput,
        returnRates: mcDeterministicRates,
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
          retirementAge: avgRetirementAge,
          endAge: maxEndAge,
          startingBalance:
            portfolioByTaxType.preTax +
            portfolioByTaxType.taxFree +
            portfolioByTaxType.hsa +
            portfolioByTaxType.afterTax,
          annualContributions:
            totalRealContrib +
            sumBy(Object.values(employerMatchByCategory), (v) => v),
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
          hasSalaryActiveFields: (input.salaryActiveFields ?? []).length > 0,
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

  /** Wipes every cached deterministic/MC/Coast-FIRE projection row —
   *  forces a full recompute without bumping PROJECTION_CACHE_ENGINE_VERSION
   *  and redeploying. Admin-only: destructive against shared cache state. */
  clearCache: adminProcedure.mutation(async ({ ctx }) => {
    const cleared = await clearProjectionCache(ctx.db);
    return { cleared };
  }),
});
