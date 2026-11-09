/**
 * Shared Zod schemas and helper builders for the projection router family
 * (monte-carlo, scenarios, strategy, stress-test, presets).
 */

import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { toNumber } from "@/lib/utils/numbers";
import * as schema from "@/lib/db/schema";
import { readStoredStrategy } from "@/lib/db/stored-strategy-key";
import type { DecumulationDefaults } from "@/lib/pure/engine/types";
import { readStoredValue } from "@/lib/db/stored-setting";
import { WITHDRAWAL_ROUTING_MODES } from "@/lib/config/withdrawal-routing";
import {
  accountCategoryEnum,
  getDefaultDecumulationOrder,
  DEFAULT_WITHDRAWAL_SPLITS as CONFIG_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import {
  decumulationDefaultsInputSchema,
  decumulationOverrideArraySchema,
  lumpSumSchema,
  storedWithdrawalOrderSchema,
  storedWithdrawalSplitsSchema,
} from "@/lib/pure/engine/types";
import {
  getAllStrategyKeys,
  getStrategyDefaults,
  getStrategyMeta,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import type { Db } from "@/lib/db";

/**
 * Baseline SS claiming age for the optimizer's ssStartAge lever: the earliest per-person
 * start age, since the household scalar `retirement_settings.ss_start_age` can be stale
 * for multi-person households (see build-engine-payload.ts); single-person uses the scalar.
 */
export function resolveSsStartAgeBaseline(
  perPersonSettings: ReadonlyArray<{ ssStartAge: number }> | undefined,
  baseEngineInputSsStartAge: number,
): number {
  return perPersonSettings && perPersonSettings.length > 1
    ? Math.min(...perPersonSettings.map((p) => p.ssStartAge))
    : baseEngineInputSsStartAge;
}

// Accumulation/decumulation override schemas ("Changes by year") for every
// projection input. Omitted = the household's saved rows (resolveProjectionOverrides);
// only an editor with unsaved changes sends its own.
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

/** retirement_settings' withdrawal routing, as its writer stores it. */
const storedRouting = z.looseObject({
  withdrawalRoutingMode: z.enum(WITHDRAWAL_ROUTING_MODES),
  withdrawalOrder: storedWithdrawalOrderSchema.nullish(),
  withdrawalSplits: storedWithdrawalSplitsSchema.nullish(),
});

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
  clientDefaults: z.output<typeof decumulationDefaultsInputSchema>,
  distributionTaxRates: DecumulationDefaults["distributionTaxRates"],
): DecumulationDefaults {
  const saved = readStoredValue("retirement_settings", settings, storedRouting);
  return {
    withdrawalRate: toNumber(settings.withdrawalRate),
    // The ONE place the routing is resolved, for every caller: a client
    // override (the Retirement page's touched Configure toggle) wins, else
    // the household's saved value; a NULL order or splits is the config's.
    withdrawalRoutingMode:
      clientDefaults.withdrawalRoutingMode ?? saved.withdrawalRoutingMode,
    withdrawalOrder:
      clientDefaults.withdrawalOrder ??
      saved.withdrawalOrder ??
      getDefaultDecumulationOrder(),
    withdrawalSplits: clientDefaults.withdrawalSplits ??
      saved.withdrawalSplits ?? { ...CONFIG_WITHDRAWAL_SPLITS },
    withdrawalTaxPreference: clientDefaults.withdrawalTaxPreference,
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
