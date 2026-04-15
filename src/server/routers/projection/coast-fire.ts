/**
 * Coast FIRE endpoints: deterministic + Monte Carlo validation.
 *
 * Contains `computeCoastFire` (deterministic binary search for the
 * earliest age at which stopping contributions still funds expenses)
 * and `computeCoastFireMC` (Monte Carlo validation variant).
 *
 * Split out of `scenarios.ts` in v0.5.3 to keep individual router files
 * under ~500 lines (Composed Router convention, RULES.md §8). Shared
 * schemas + helpers remain in `_shared.ts`.
 */
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { DEFAULT_WITHDRAWAL_RATE } from "@/lib/constants";
import { findCoastFireAge } from "@/lib/calculators/coast-fire";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import { toNumber } from "@/server/helpers";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/calculators/types";
import {
  accountCategoryEnum,
  getDefaultDecumulationOrder,
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
  buildCoastFireProfileSwitches,
} from "./_shared";

export const coastFireRouter = createTRPCRouter({
  /**
   * Coast FIRE
   *
   * Finds the earliest age at which contributions can stop and the plan
   * still funds expenses through end of plan. Uses the same engine payload
   * as computeProjection, then binary-searches candidate "coast ages" via
   * ~log₂(retirementAge - currentAge) engine runs.
   *
   * Success criterion: `portfolioDepletionAge === null` AND
   * `sustainableWithdrawal >= projectedExpenses` at the first decumulation
   * year. See `findCoastFireAge` for the full algorithm.
   */
  computeCoastFire: protectedProcedure
    .input(
      z.object({
        // Mirrors the computeProjection input subset that affects the engine.
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
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
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
      }),
    )
    .query(async ({ ctx, input }) => {
      const data = await fetchRetirementData(ctx.db, {
        snapshotId: input.snapshotId,
      });
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
      if (!payload) return { result: null };

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

      const result = findCoastFireAge(engineInput);

      // Deflate nominal values to today's dollars for display (matches the
      // convention in retirement-card.tsx:118-134). Sustainable withdrawal and
      // retirement-year expenses land at retirementAge; end balance lands at
      // projectionEndAge. The calculator stays pure; deflation is a display
      // concern and happens at the router boundary.
      const yearsToRetirement = Math.max(
        0,
        engineInput.retirementAge - engineInput.currentAge,
      );
      const yearsToEnd = Math.max(
        0,
        engineInput.projectionEndAge - engineInput.currentAge,
      );
      const retirementDeflator = Math.pow(
        1 + engineInput.inflationRate,
        yearsToRetirement,
      );
      const endDeflator = Math.pow(1 + engineInput.inflationRate, yearsToEnd);

      return {
        result: {
          ...result,
          sustainableWithdrawalToday:
            result.sustainableWithdrawal / retirementDeflator,
          projectedExpensesAtRetirementToday:
            result.projectedExpensesAtRetirement / retirementDeflator,
          endBalanceToday: result.endBalance / endDeflator,
        },
      };
    }),

  /**
   * Coast FIRE — Monte Carlo validation
   *
   * Finds the earliest age at which stopping contributions still produces
   * a ≥90% Monte Carlo success rate. Binary searches candidate ages in
   * [currentAge, retirementAge), running `calculateMonteCarlo` at each
   * probe with `seed: 42` (common random numbers across probes for
   * variance reduction) and a hardcoded "default" MC preset for
   * reproducibility.
   *
   * Per advisor review: monotonicity of MC success rate in coast age is
   * *approximate*, not strict (IRMAA/ACA/LTCG cliffs can break it). After
   * binary search returns `lo`, we re-probe `lo - 1` as a sanity check.
   * If the re-probe also passes, the true earliest age may be lower but
   * we return the search result honestly with a warning.
   *
   * Cost: ~5-6 probes × 1 MC run × 1000 trials ≈ 4-6s wall clock (profiled
   * 2026-04-13). Rate-limited via `expensiveRateLimitMiddleware`.
   */
  computeCoastFireMC: protectedProcedure
    .use(expensiveRateLimitMiddleware)
    .input(
      z.object({
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
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
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
      }),
    )
    .query(async ({ ctx, input }) => {
      // Fetch the engine payload + MC-specific tables in parallel. Mirrors
      // computeMonteCarloProjection for the "default" preset only — no
      // user-adjustable preset, no asset class overrides, no inflation
      // overrides. Coast FIRE MC uses defaults for reproducibility.
      const [data, assetClasses, assetCorrelations, presetRows, presetGpRows] =
        await Promise.all([
          fetchRetirementData(ctx.db, { snapshotId: input.snapshotId }),
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
          ctx.db
            .execute<{
              age: number;
              asset_class_id: number;
              allocation: string;
            }>(
              sql`SELECT gp.age, gp.asset_class_id, gp.allocation
                FROM mc_preset_glide_paths gp
                JOIN mc_presets p ON p.id = gp.preset_id
                WHERE p.key = 'default'
                ORDER BY gp.age, gp.asset_class_id`,
            )
            .then((r) => r.rows),
        ]);

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
      if (!payload) return { result: null };

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

      const preset = presetRows[0];
      if (!preset) {
        return {
          result: {
            coastFireAge: null,
            status: "unreachable" as const,
            successRate: 0,
            stopNowSuccessRate: 0,
            spendingStabilityRate: 0,
            confidenceThreshold: 0.9,
            probesRun: 0,
            warning: "Default MC preset not found in database.",
            mcResult: null,
          },
        };
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

      const CONFIDENCE = 0.9;
      const NUM_TRIALS = 1000;
      const SEED = 42;

      // Probe helper: run MC with a profile switch at `coastAge` that zeros
      // contributions AND employer match from that year forward. Pre-coast
      // years use the user's actual configured plan (specs/realContribs/rate)
      // so the pre-coast-year balance accumulates normally. Shared seed
      // across probes = common random numbers = consistent variance across
      // candidate ages.
      let probesRun = 0;
      const probeMC = (coastAge: number) => {
        probesRun += 1;
        return calculateMonteCarlo({
          engineInput: {
            ...engineInput,
            profileSwitches: buildCoastFireProfileSwitches(
              engineInput,
              coastAge,
            ),
          },
          numTrials: NUM_TRIALS,
          seed: SEED,
          assetClasses: mcAssetClasses,
          correlations: mcCorrelations,
          glidePath: mcGlidePath,
          inflationRisk,
        });
      };
      const probeAt = (coastAge: number): number =>
        probeMC(coastAge).successRate;

      const passes = (rate: number): boolean => rate >= CONFIDENCE;

      // Edge case: already past retirement.
      if (engineInput.currentAge >= engineInput.retirementAge) {
        const fullResult = probeMC(engineInput.currentAge);
        return {
          result: {
            coastFireAge: engineInput.currentAge,
            status: "already_coast" as const,
            successRate: fullResult.successRate,
            stopNowSuccessRate: fullResult.successRate,
            spendingStabilityRate: fullResult.spendingStabilityRate,
            confidenceThreshold: CONFIDENCE,
            probesRun,
            warning: null,
            mcResult: fullResult,
          },
        };
      }

      // Probe stopping today — captured for every branch so the client can
      // show "Stopping today: X% MC" alongside the found age. This is the
      // key signal: when deterministic says "already coast" but MC says
      // "need age N," the gap is quantified by stopNowResult.successRate.
      const stopNowResult = probeMC(engineInput.currentAge);
      const stopNowSuccessRate = stopNowResult.successRate;
      if (passes(stopNowSuccessRate)) {
        return {
          result: {
            coastFireAge: engineInput.currentAge,
            status: "already_coast" as const,
            successRate: stopNowSuccessRate,
            stopNowSuccessRate,
            spendingStabilityRate: stopNowResult.spendingStabilityRate,
            confidenceThreshold: CONFIDENCE,
            probesRun,
            warning: null,
            mcResult: stopNowResult,
          },
        };
      }

      // Probe stopping the year before retirement — is the plan reachable at all?
      const maxCoastAge = engineInput.retirementAge - 1;
      const stopLateResult = probeMC(maxCoastAge);
      if (!passes(stopLateResult.successRate)) {
        return {
          result: {
            coastFireAge: null,
            status: "unreachable" as const,
            successRate: stopLateResult.successRate,
            stopNowSuccessRate,
            spendingStabilityRate: stopLateResult.spendingStabilityRate,
            confidenceThreshold: CONFIDENCE,
            probesRun,
            warning: null,
            mcResult: stopLateResult,
          },
        };
      }

      // Binary search for earliest passing age.
      let lo = engineInput.currentAge + 1;
      let hi = maxCoastAge;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (passes(probeAt(mid))) {
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
        const rePrior = probeAt(lo - 1);
        if (passes(rePrior)) {
          warning =
            "MC success rate is non-monotone near this age — the true earliest age may be lower. Likely caused by IRMAA/ACA/LTCG bracket interactions.";
        }
      }

      // One more probe at lo for the spending stability rate + full MC data
      // (chart and hero card consume the mcResult from this query).
      const finalResult = probeMC(lo);

      return {
        result: {
          coastFireAge: lo,
          status: "found" as const,
          successRate: finalResult.successRate,
          stopNowSuccessRate,
          spendingStabilityRate: finalResult.spendingStabilityRate,
          confidenceThreshold: CONFIDENCE,
          probesRun,
          warning,
          mcResult: finalResult,
        },
      };
    }),
});
