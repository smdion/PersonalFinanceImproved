/**
 * Shared infrastructure for the projection router family.
 *
 * Every sibling file in this directory (monte-carlo, scenarios, strategy,
 * stress-test, presets) imports its Zod schemas and helper builders from
 * here. This keeps shared pipeline code in exactly one place and removes
 * the duplicate-schema risk of spreading them across the sibling files.
 */
import { glidePathFromRows } from "@/lib/pure/stock-share";
import { z } from "zod/v4";
import { eq, asc } from "drizzle-orm";
import { toNumber } from "@/server/helpers";
import * as schema from "@/lib/db/schema";
import type { db as _db } from "@/lib/db";
import { DEFAULT_MC_INFLATION_RISK } from "@/lib/constants";
import { DEFAULT_WITHDRAWAL_ROUTING_MODE } from "@/lib/config/withdrawal-routing";
import type {
  AccountCategory,
  DecumulationDefaults,
} from "@/lib/calculators/types";
import {
  accountCategoryEnum,
  getDefaultDecumulationOrder,
  DEFAULT_WITHDRAWAL_SPLITS as CONFIG_WITHDRAWAL_SPLITS,
  PARENT_CATEGORY_VALUES,
} from "@/lib/config/account-types";
import {
  getAllStrategyKeys,
  getStrategyMeta,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";

/**
 * Baseline "current" SS claiming age for the strategy optimizer's
 * ssStartAge lever. `baseEngineInput.ssStartAge` is the household-scalar
 * `retirement_settings.ss_start_age`, which can be STALE for a
 * multi-person household — "SS Start Age" is written ONLY to
 * `retirement_profile_people` (see build-engine-payload.ts's own comment
 * on this exact staleness). Sourcing the lever's baseline from the stale
 * scalar can clamp the lever out of range entirely, or offer "delay from
 * 68" for a household really claiming at 62. Use the earliest of the real
 * per-person start ages instead, for multi-person households — the
 * household's actual earliest actionable claiming age. Single-person
 * households have no separate per-person source to drift from the
 * scalar, so it's already correct there.
 */
export function resolveSsStartAgeBaseline(
  perPersonSettings: ReadonlyArray<{ ssStartAge: number }> | undefined,
  baseEngineInputSsStartAge: number,
): number {
  return perPersonSettings && perPersonSettings.length > 1
    ? Math.min(...perPersonSettings.map((p) => p.ssStartAge))
    : baseEngineInputSsStartAge;
}

const lumpSumSchema = z
  .array(
    z.object({
      amount: z.number().positive(),
      targetAccount: z.enum(accountCategoryEnum()),
      taxType: z.enum(["traditional", "roth"]).optional(),
      targetAccountName: z.string().max(200).optional(),
      // Disambiguates two household members' identically-named
      // accounts — see LumpSum.targetOwnerName's docblock (calculators/types/shared.ts).
      // Optional so lump sums saved before this field existed keep parsing.
      targetOwnerName: z.string().max(200).optional(),
      // Whose money a lump sum with no named account is (the Brokerage
      // page's are Portfolio savings) — see LumpSum.targetParentCategory.
      targetParentCategory: z.enum(PARENT_CATEGORY_VALUES).optional(),
      label: z.string().max(100).optional(),
    }),
  )
  .optional();

// Shared Zod schemas for accumulation/decumulation overrides ("Changes by
// year") — used by every projection procedure's input. OMITTED means the
// household's saved rows (resolveProjectionOverrides): every surface — the
// dashboard, the Retirement page, strategy comparison, stress tests — gets
// the same baseline without each client loading them, and only an editor
// with unsaved changes sends its own.
const accumulationOverrideArraySchema = z.array(
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
    accountCaps: z.record(z.enum(accountCategoryEnum()), z.number()).optional(),
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
);

/**
 * Top-level `decumulationDefaults` query input — the live withdrawal-strategy
 * settings a client can send to override DB defaults. Was byte-identical
 * across scenarios.ts, monte-carlo.ts, and coast-fire.ts (x2).
 */
//
// No `withdrawalRate`: buildDecumulationDefaults always takes the rate from
// retirement_settings (it seeds rate-based first-year spending), so a
// client-sent rate was accepted and silently ignored.
export const decumulationDefaultsInputSchema = z
  .object({
    // Deliberately `.optional()`, NOT `.default("bracket_filling")` — a
    // default here would make "the caller omitted this" indistinguishable
    // from "the caller explicitly chose bracket_filling," which would
    // permanently hide the household's own `retirement_settings
    // .withdrawal_routing_mode` behind an unreachable request-level
    // default. `buildDecumulationDefaults` below is where the real
    // fallback (client override > DB setting > "bracket_filling") lives.
    withdrawalRoutingMode: z
      .enum(["bracket_filling", "waterfall", "percentage"])
      .optional(),
    // `.optional()`, NOT `.default(...)` — same reasoning as
    // `withdrawalRoutingMode` above: a field-level default here makes "the
    // caller omitted this" indistinguishable from "the caller sent the
    // config default," which permanently hides the household's persisted
    // `retirement_settings.withdrawal_order` / `.withdrawal_splits` behind
    // an unreachable request default. The client (the Retirement page's
    // Configure editors) only sends these once the user has actively
    // touched them; `buildDecumulationDefaults` owns the real fallback
    // (client override > DB setting > config default).
    withdrawalOrder: z.array(z.enum(accountCategoryEnum())).optional(),
    withdrawalSplits: z
      .record(z.enum(accountCategoryEnum()), z.number())
      .optional(),
    withdrawalTaxPreference: z
      .record(z.string(), z.enum(["traditional", "roth"]))
      .default({}),
  })
  // NOTE: no `withdrawalRoutingMode` / `withdrawalOrder` / `withdrawalSplits`
  // key in this object-level default — same reason as the field-level
  // `.optional()` on each above. A caller that omits `decumulationDefaults`
  // entirely (Tax Optimization's comparison procedures) must still reach the
  // DB fallback in `buildDecumulationDefaults`, not get the config default
  // baked in here a second way.
  .default({
    withdrawalTaxPreference: {},
  });

const decumulationOverrideArraySchema = z.array(
  // No per-year `withdrawalRate`: none of the spending strategies reads
  // it, so an override could only ever change nothing.
  z.object({
    year: z.number().int(),
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
    // See DecumulationOverride's docblock in
    // engine-config.ts. Without these two, zod silently strips both
    // fields at this boundary regardless of what the engine/type layer
    // supports underneath.
    rothBracketTarget: z.number().min(0).max(1).optional(),
    rmdSmoothingMaxBracketTarget: z.number().min(0).max(1).optional(),
    lumpSums: lumpSumSchema,
    reset: z.boolean().optional(),
    notes: z.string().optional(),
  }),
);

export const accumulationOverrideSchema =
  accumulationOverrideArraySchema.optional();
export const decumulationOverrideSchema =
  decumulationOverrideArraySchema.optional();

type ResolvedProjectionOverrides = {
  accumulationOverrides: z.infer<typeof accumulationOverrideArraySchema>;
  decumulationOverrides: z.infer<typeof decumulationOverrideArraySchema>;
};

/** The "Changes by year" a projection runs with: what the caller sent, or
 *  — when it sent none — the household's saved rows (validated through the
 *  same schemas; an unreadable saved row set counts as none). */
export async function resolveProjectionOverrides(
  db: Db,
  input: {
    accumulationOverrides?: ResolvedProjectionOverrides["accumulationOverrides"];
    decumulationOverrides?: ResolvedProjectionOverrides["decumulationOverrides"];
  },
): Promise<ResolvedProjectionOverrides> {
  const saved = async <T>(
    overrideType: "accumulation" | "decumulation",
    parse: (v: unknown) => { success: boolean; data?: T },
  ): Promise<T | undefined> => {
    const rows = await db
      .select({ overrides: schema.projectionOverrides.overrides })
      .from(schema.projectionOverrides)
      .where(eq(schema.projectionOverrides.overrideType, overrideType));
    const parsed = parse(rows[0]?.overrides ?? []);
    return parsed.success ? parsed.data : undefined;
  };
  const [accumulationOverrides, decumulationOverrides] = await Promise.all([
    input.accumulationOverrides ??
      saved("accumulation", (v) =>
        accumulationOverrideArraySchema.safeParse(v),
      ),
    input.decumulationOverrides ??
      saved("decumulation", (v) =>
        decumulationOverrideArraySchema.safeParse(v),
      ),
  ]);
  return {
    accumulationOverrides: accumulationOverrides ?? [],
    decumulationOverrides: decumulationOverrides ?? [],
  };
}

/**
 * Build strategyParams from DB settings columns: each strategy's config
 * defaults, with every param field read from its own column (config
 * `paramFields[].column`) when set. A null column keeps the default.
 */
export function buildStrategyParams(
  settings: Readonly<Record<string, unknown>>,
): Partial<Record<WithdrawalStrategyType, Record<string, number | boolean>>> {
  const out: Partial<
    Record<WithdrawalStrategyType, Record<string, number | boolean>>
  > = {};
  for (const key of getAllStrategyKeys()) {
    const meta = getStrategyMeta(key);
    if (meta.paramFields.length === 0) continue;
    const params: Record<string, number | boolean> = {
      ...meta.defaultParams,
    };
    for (const field of meta.paramFields) {
      const stored = settings[field.column];
      if (stored == null) continue;
      params[field.key] =
        field.type === "boolean" ? Boolean(stored) : toNumber(String(stored));
    }
    out[key] = params;
  }
  return out;
}

/**
 * Build decumulation defaults from DB settings + client-supplied routing overrides.
 * Shared by computeProjection and computeMonteCarloProjection.
 */
export function buildDecumulationDefaults(
  settings: Parameters<typeof buildStrategyParams>[0] & {
    withdrawalRate: string | null;
    withdrawalStrategy: string | null;
    withdrawalRoutingMode?: string | null;
    withdrawalOrder?: string[] | null;
    withdrawalSplits?: Record<string, number> | null;
    rmdExcessHandling?: string | null;
    qcdMaximize?: boolean | null;
    rmdSmoothingEnabled?: boolean | null;
    rmdSmoothingMaxBracketTarget?: string | null;
    discretionaryWithdrawalOrder?: string | null;
  },
  clientDefaults: {
    withdrawalRoutingMode?: string;
    withdrawalOrder?: string[];
    withdrawalSplits?: Record<string, number>;
    withdrawalTaxPreference: Record<string, string>;
  },
  distributionTaxRates: DecumulationDefaults["distributionTaxRates"],
): DecumulationDefaults {
  return {
    withdrawalRate: toNumber(settings.withdrawalRate),
    // Client override wins when the caller sent one (the Retirement page's
    // per-session Configure toggle, once the user actively touches it);
    // otherwise fall back to the household's persisted
    // `retirement_settings.withdrawal_routing_mode`; "bracket_filling" only
    // if even that's somehow missing (pre-migration row). This is the ONE
    // place that resolves the mode — every caller (computeProjection,
    // Monte Carlo, Tax Optimization) goes through this function so they
    // can't independently drift on which value wins.
    withdrawalRoutingMode: (clientDefaults.withdrawalRoutingMode ??
      settings.withdrawalRoutingMode ??
      DEFAULT_WITHDRAWAL_ROUTING_MODE) as DecumulationDefaults["withdrawalRoutingMode"],
    // Same three-tier resolution as `withdrawalRoutingMode` above: a
    // touched-session client override wins, else the household's persisted
    // `retirement_settings.withdrawal_order` / `.withdrawal_splits`, else
    // the config default. A NULL DB column means "never customized" and
    // falls through to the config default.
    withdrawalOrder: (clientDefaults.withdrawalOrder ??
      settings.withdrawalOrder ??
      getDefaultDecumulationOrder()) as AccountCategory[],
    withdrawalSplits: (clientDefaults.withdrawalSplits ??
      settings.withdrawalSplits ?? {
        ...CONFIG_WITHDRAWAL_SPLITS,
      }) as Record<AccountCategory, number>,
    withdrawalTaxPreference: clientDefaults.withdrawalTaxPreference as Partial<
      Record<AccountCategory, "traditional" | "roth">
    >,
    distributionTaxRates,
    withdrawalStrategy:
      (settings.withdrawalStrategy as WithdrawalStrategyType) ?? "fixed",
    strategyParams: buildStrategyParams(settings),
    rmdExcessHandling:
      settings.rmdExcessHandling === "spend" ? "spend" : "reinvest",
    qcdMaximize: settings.qcdMaximize ?? false,
    rmdSmoothingEnabled: settings.rmdSmoothingEnabled ?? false,
    rmdSmoothingMaxBracketTarget: settings.rmdSmoothingMaxBracketTarget
      ? toNumber(settings.rmdSmoothingMaxBracketTarget)
      : undefined,
    discretionaryWithdrawalOrder:
      settings.discretionaryWithdrawalOrder === "brokerage_first"
        ? "brokerage_first"
        : "roth_first",
  };
}

// Coast FIRE's "stop contributing at age N" lives with the calculator
// (lib/calculators/coast-fire.ts) so the baseline finder and every
// router probe stop contributions the same way.
export { buildCoastFireProfileSwitches } from "@/lib/calculators/coast-fire";

type Db = typeof _db;

/** The saved Simulation inflation override (Simulation assumptions). */
export type SavedInflationOverrides = { stdDev?: number } | null;

/**
 * The Simulation's inflation risk — the spread of each year's inflation
 * around the plan's own rates — for every route that runs trials (the
 * Simulation, strategy comparison, Coast FIRE and its probe): this run's
 * UI override, else the saved override, else the preset's, else the
 * default. One resolver, so no route quietly ignores the household's
 * setting.
 */
export function resolveInflationRisk(opts: {
  ui?: { stdDev: number } | null;
  saved: SavedInflationOverrides;
  presetStdDev?: number | null;
}): { stdDev: number } {
  return {
    stdDev:
      opts.ui?.stdDev ??
      opts.saved?.stdDev ??
      opts.presetStdDev ??
      DEFAULT_MC_INFLATION_RISK.stdDev,
  };
}

/** Read the saved inflation override (null when none is saved). */
export async function loadSavedInflationOverrides(
  db: Db,
): Promise<SavedInflationOverrides> {
  const row = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "mc_inflation_overrides"))
    .then((r) => r[0] ?? null);
  const value = (row?.value ?? null) as { stdDev?: unknown } | null;
  return value && typeof value.stdDev === "number"
    ? { stdDev: value.stdDev }
    : null;
}

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
  /** Without a preset (the routes that call this and have none). */
  effectiveInflationRisk: { stdDev: number };
  /** Raw saved inflation override — null if none saved. Callers that surface
   *  this to the client (e.g. computeMonteCarloProjection) use this as-is. */
  savedInflationOverrides: SavedInflationOverrides;
}> {
  const [
    assetClasses,
    assetCorrelations,
    glidePathRows,
    savedInflationOverrides,
  ] = await Promise.all([
    db
      .select()
      .from(schema.assetClassParams)
      .where(eq(schema.assetClassParams.isActive, true))
      .orderBy(asc(schema.assetClassParams.sortOrder)),
    db.select().from(schema.assetClassCorrelations),
    db.select().from(schema.glidePathAllocations),
    loadSavedInflationOverrides(db),
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

  const mcGlidePath = glidePathFromRows(glidePathRows);

  const effectiveInflationRisk = resolveInflationRisk({
    saved: savedInflationOverrides,
  });

  return {
    mcAssetClasses,
    mcCorrelations,
    mcGlidePath,
    effectiveInflationRisk,
    savedInflationOverrides,
  };
}
