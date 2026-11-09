/**
 * Shared infrastructure for the projection router family.
 *
 * Every sibling file in this directory (monte-carlo, scenarios, strategy,
 * stress-test, presets) imports its Zod schemas and helper builders from
 * here. This keeps shared pipeline code in exactly one place and removes
 * the duplicate-schema risk of spreading them across the sibling files.
 */

import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { toNumber } from "@/lib/utils/numbers";
import * as schema from "@/lib/db/schema";
import { readStoredStrategy } from "@/lib/db/stored-strategy-key";
import type { AccountCategory } from "@/lib/config/account-types";
import type { DecumulationDefaults } from "@/lib/pure/engine/types";
import {
  accountCategoryEnum,
  getDefaultDecumulationOrder,
  DEFAULT_WITHDRAWAL_SPLITS as CONFIG_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import {
  decumulationOverrideArraySchema,
  lumpSumSchema,
} from "@/lib/pure/engine/types";
import {
  getAllStrategyKeys,
  getStrategyDefaults,
  getStrategyMeta,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import type { Db } from "@/lib/db";

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
    const params: Record<string, number | boolean> = getStrategyDefaults(key);
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
    withdrawalStrategy: string;
    withdrawalRoutingMode: string;
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
    // per-session Configure toggle, once the user touches it); otherwise the
    // persisted `retirement_settings.withdrawal_routing_mode` (NOT NULL,
    // default "bracket_filling"). The ONE place that resolves the mode —
    // every caller (computeProjection, Monte Carlo, Tax Optimization) goes
    // through this function, so all read the same value.
    withdrawalRoutingMode: (clientDefaults.withdrawalRoutingMode ??
      settings.withdrawalRoutingMode) as DecumulationDefaults["withdrawalRoutingMode"],
    // Like `withdrawalRoutingMode` above, a touched-session client
    // override wins, else the household's persisted
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
    withdrawalStrategy: readStoredStrategy(settings.withdrawalStrategy),
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
// (lib/pure/retirement/coast-fire.ts) so the baseline finder and every
// router probe stop contributions the same way.
export { buildCoastFireProfileSwitches } from "@/lib/pure/retirement/coast-fire";
