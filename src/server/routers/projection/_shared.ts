/**
 * Shared infrastructure for the projection router family.
 *
 * Every sibling file in this directory (monte-carlo, scenarios, strategy,
 * stress-test, presets) imports its Zod schemas and helper builders from
 * here. This keeps shared pipeline code in exactly one place and removes
 * the duplicate-schema risk the advisor flagged for the v0.5.2 split.
 *
 * Extracted from the old `src/server/routers/projection.ts` monolith in PR 2
 * of the v0.5.2 file-split refactor (see `.scratch/docs/V052-REFACTOR-PLAN.md`).
 * Pure relocation — no logic changes.
 */
import { z } from "zod/v4";
import { eq, asc } from "drizzle-orm";
import { toNumber } from "@/server/helpers";
import * as schema from "@/lib/db/schema";
import type { db as _db } from "@/lib/db";
import type {
  AccountCategory,
  DecumulationDefaults,
  ProfileSwitch,
  ProjectionInput,
} from "@/lib/calculators/types";
import {
  accountCategoryEnum,
  getAllCategories,
} from "@/lib/config/account-types";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";

export const lumpSumSchema = z
  .array(
    z.object({
      amount: z.number().positive(),
      targetAccount: z.enum(accountCategoryEnum()),
      taxType: z.enum(["traditional", "roth"]).optional(),
      targetAccountName: z.string().max(200).optional(),
      label: z.string().max(100).optional(),
    }),
  )
  .optional();

// Shared Zod schemas for accumulation/decumulation overrides — used by
// computeProjection and computeMonteCarloProjection inputs.
export const accumulationOverrideSchema = z
  .array(
    z.object({
      year: z.number().int(),
      contributionRate: z.number().min(0).max(1).optional(),
      routingMode: z.enum(["waterfall", "percentage"]).optional(),
      accountOrder: z.array(z.enum(accountCategoryEnum())).optional(),
      accountSplits: z
        .record(z.enum(accountCategoryEnum()), z.number())
        .optional(),
      taxSplits: z
        .record(z.enum(accountCategoryEnum()), z.number().min(0).max(1))
        .optional(),
      accountCaps: z
        .record(z.enum(accountCategoryEnum()), z.number())
        .optional(),
      taxTypeCaps: z
        .object({
          traditional: z.number().optional(),
          roth: z.number().optional(),
        })
        .optional(),
      lumpSums: lumpSumSchema,
      reset: z.boolean().optional(),
      notes: z.string().optional(),
    }),
  )
  .default([]);

export const decumulationOverrideSchema = z
  .array(
    z.object({
      year: z.number().int(),
      withdrawalRate: z.number().min(0).max(1).optional(),
      withdrawalRoutingMode: z
        .enum(["bracket_filling", "waterfall", "percentage"])
        .optional(),
      withdrawalOrder: z.array(z.enum(accountCategoryEnum())).optional(),
      withdrawalSplits: z
        .record(z.enum(accountCategoryEnum()), z.number())
        .optional(),
      withdrawalTaxPreference: z
        .record(z.enum(accountCategoryEnum()), z.enum(["traditional", "roth"]))
        .optional(),
      withdrawalAccountCaps: z
        .record(z.enum(accountCategoryEnum()), z.number())
        .optional(),
      withdrawalTaxTypeCaps: z
        .object({
          traditional: z.number().optional(),
          roth: z.number().optional(),
        })
        .optional(),
      rothConversionTarget: z.number().min(0).max(1).optional(),
      lumpSums: lumpSumSchema,
      reset: z.boolean().optional(),
      notes: z.string().optional(),
    }),
  )
  .default([]);

/** Build strategyParams from DB settings columns. */
export function buildStrategyParams(settings: {
  gkUpperGuardrail: string | null;
  gkLowerGuardrail: string | null;
  gkIncreasePct: string | null;
  gkDecreasePct: string | null;
  gkSkipInflationAfterLoss: boolean;
  sdAnnualDeclineRate: string | null;
  cpWithdrawalPercent: string | null;
  cpFloorPercent: string | null;
  enWithdrawalPercent: string | null;
  enRollingYears: number | null;
  enFloorPercent: string | null;
  vdBasePercent: string | null;
  vdCeilingPercent: string | null;
  vdFloorPercent: string | null;
  rmdMultiplier: string | null;
}): Partial<Record<WithdrawalStrategyType, Record<string, number | boolean>>> {
  return {
    guyton_klinger: {
      upperGuardrail: toNumber(settings.gkUpperGuardrail ?? "0.80"),
      lowerGuardrail: toNumber(settings.gkLowerGuardrail ?? "1.20"),
      increasePercent: toNumber(settings.gkIncreasePct ?? "0.10"),
      decreasePercent: toNumber(settings.gkDecreasePct ?? "0.10"),
      skipInflationAfterLoss: settings.gkSkipInflationAfterLoss,
    },
    spending_decline: {
      annualDeclineRate: toNumber(settings.sdAnnualDeclineRate ?? "0.02"),
    },
    constant_percentage: {
      withdrawalPercent: toNumber(settings.cpWithdrawalPercent ?? "0.05"),
      floorPercent: toNumber(settings.cpFloorPercent ?? "0.90"),
    },
    endowment: {
      withdrawalPercent: toNumber(settings.enWithdrawalPercent ?? "0.05"),
      rollingYears: settings.enRollingYears ?? 10,
      floorPercent: toNumber(settings.enFloorPercent ?? "0.90"),
    },
    vanguard_dynamic: {
      basePercent: toNumber(settings.vdBasePercent ?? "0.05"),
      ceilingPercent: toNumber(settings.vdCeilingPercent ?? "0.05"),
      floorPercent: toNumber(settings.vdFloorPercent ?? "0.025"),
    },
    rmd_spending: {
      rmdMultiplier: toNumber(settings.rmdMultiplier ?? "1.0"),
    },
  };
}

/**
 * Build decumulation defaults from DB settings + client-supplied routing overrides.
 * Shared by computeProjection and computeMonteCarloProjection.
 */
export function buildDecumulationDefaults(
  settings: Parameters<typeof buildStrategyParams>[0] & {
    withdrawalRate: string | null;
    withdrawalStrategy: string | null;
  },
  clientDefaults: {
    withdrawalRoutingMode: string;
    withdrawalOrder: string[];
    withdrawalSplits: Record<string, number>;
    withdrawalTaxPreference: Record<string, string>;
  },
  distributionTaxRates: DecumulationDefaults["distributionTaxRates"],
): DecumulationDefaults {
  return {
    withdrawalRate: toNumber(settings.withdrawalRate),
    withdrawalRoutingMode:
      clientDefaults.withdrawalRoutingMode as DecumulationDefaults["withdrawalRoutingMode"],
    withdrawalOrder: clientDefaults.withdrawalOrder as AccountCategory[],
    withdrawalSplits: clientDefaults.withdrawalSplits as Record<
      AccountCategory,
      number
    >,
    withdrawalTaxPreference: clientDefaults.withdrawalTaxPreference as Partial<
      Record<AccountCategory, "traditional" | "roth">
    >,
    distributionTaxRates,
    withdrawalStrategy:
      (settings.withdrawalStrategy as WithdrawalStrategyType) ?? "fixed",
    strategyParams: buildStrategyParams(settings),
  };
}

/**
 * Build a merged `profileSwitches` array that zeros contributions + employer
 * match from the Coast FIRE age onward.
 *
 * Injects a synthetic `ProfileSwitch` at `coastYear = currentYear + (coastAge
 * - currentAge)` with empty contribution specs, zero employer match rates,
 * zero base-year contributions/match, and contribution rate 0. The engine at
 * projection-year-handlers.ts:582-611 processes switches sticky-forward, so
 * every year from coastYear onward sees zero contributions AND zero employer
 * match — which fixes the bug where `contributionRate: 0` in an
 * accumulation override was silently ignored (engine line 985 has
 * `rateCeiling > 0` which treats zero rate as "unset, use specs").
 *
 * Merges with the user's own `profileSwitches`: keeps any user-authored
 * switches strictly before the coast year (so pre-coast years still reflect
 * the user's configured future), and drops user switches at or after the
 * coast year (those are moot — everything's zero from coast year forward).
 *
 * Used by computeProjection, computeMonteCarloProjection (when rendering
 * the coast scenario chart), and computeCoastFireMC (when probing inside
 * the binary search).
 */
export function buildCoastFireProfileSwitches(
  baseEngineInput: Pick<
    ProjectionInput,
    "asOfDate" | "currentAge" | "profileSwitches"
  >,
  coastAge: number,
): ProfileSwitch[] {
  const coastYear =
    baseEngineInput.asOfDate.getFullYear() +
    (coastAge - baseEngineInput.currentAge);
  const zeroRecord = Object.fromEntries(
    getAllCategories().map((c) => [c, 0]),
  ) as Record<AccountCategory, number>;
  const coastSwitch: ProfileSwitch = {
    year: coastYear,
    contributionSpecs: [],
    employerMatchRateByCategory: zeroRecord,
    baseYearContributions: zeroRecord,
    baseYearEmployerMatch: zeroRecord,
    contributionRate: 0,
  };
  const userSwitches = baseEngineInput.profileSwitches ?? [];
  return [...userSwitches.filter((s) => s.year < coastYear), coastSwitch];
}

type Db = typeof _db;

/**
 * Bootstrap parallel fetch of the three core MC DB tables plus the saved
 * inflation-risk override, then map them to the shapes the engine expects.
 *
 * Used by computeStrategyComparison, analyzeStrategy, and
 * computeMonteCarloProjection. NOT used by computeCoastFireMC (which reads
 * a preset-specific glide path keyed on mcPresets.key = 'default').
 */
export async function buildMcInputs(db: Db): Promise<{
  mcAssetClasses: {
    id: number;
    name: string;
    meanReturn: number;
    stdDev: number;
  }[];
  mcCorrelations: { classAId: number; classBId: number; correlation: number }[];
  mcGlidePath: { age: number; allocations: Record<number, number> }[];
  effectiveInflationRisk: { meanRate: number; stdDev: number };
  /** Raw saved inflation override — null if none saved. Callers that surface
   *  this to the client (e.g. computeMonteCarloProjection) use this as-is. */
  savedInflationOverrides: { meanRate?: number; stdDev?: number } | null;
}> {
  const BASE_INFLATION_RISK = { meanRate: 0.025, stdDev: 0.012 };

  const [assetClasses, assetCorrelations, glidePathRows, savedInflationRow] =
    await Promise.all([
      db
        .select()
        .from(schema.assetClassParams)
        .where(eq(schema.assetClassParams.isActive, true))
        .orderBy(asc(schema.assetClassParams.sortOrder)),
      db.select().from(schema.assetClassCorrelations),
      db.select().from(schema.glidePathAllocations),
      db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "mc_inflation_overrides"))
        .then((r) => r[0] ?? null),
    ]);

  const mcAssetClasses = assetClasses.map((ac) => ({
    id: ac.id,
    name: ac.name,
    meanReturn: toNumber(ac.meanReturn),
    stdDev: toNumber(ac.stdDev),
  }));

  const mcCorrelations = assetCorrelations.map((c) => ({
    classAId: c.classAId,
    classBId: c.classBId,
    correlation: toNumber(c.correlation),
  }));

  const gpByAge = new Map<number, Record<number, number>>();
  for (const gp of glidePathRows) {
    if (!gpByAge.has(gp.age)) gpByAge.set(gp.age, {});
    gpByAge.get(gp.age)![gp.assetClassId] = toNumber(gp.allocation);
  }
  const mcGlidePath = Array.from(gpByAge.entries())
    .sort(([a], [b]) => a - b)
    .map(([gpAge, allocations]) => ({ age: gpAge, allocations }));

  const savedInflationOverrides = (savedInflationRow?.value ?? null) as {
    meanRate?: number;
    stdDev?: number;
  } | null;
  const effectiveInflationRisk = savedInflationOverrides
    ? {
        meanRate:
          savedInflationOverrides.meanRate ?? BASE_INFLATION_RISK.meanRate,
        stdDev: savedInflationOverrides.stdDev ?? BASE_INFLATION_RISK.stdDev,
      }
    : BASE_INFLATION_RISK;

  return {
    mcAssetClasses,
    mcCorrelations,
    mcGlidePath,
    effectiveInflationRisk,
    savedInflationOverrides,
  };
}
