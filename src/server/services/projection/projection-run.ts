/** A projection run: its household data and engine payload, and the engine
 *  input built from them ("Changes by year" and decumulation defaults). */

import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { toNumber } from "@/lib/utils/numbers";
import * as schema from "@/lib/db/schema";
import { readStoredStrategy } from "@/lib/db/stored-strategy-key";
import { readStoredValue } from "@/lib/db/stored-setting";
import { WITHDRAWAL_ROUTING_MODES } from "@/lib/config/withdrawal-routing";
import {
  accountCategoryEnum,
  getDefaultDecumulationOrder,
  DEFAULT_WITHDRAWAL_SPLITS as CONFIG_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import type {
  AccumulationOverride,
  DecumulationDefaults,
  DecumulationOverride,
} from "@/lib/pure/engine/types";
import {
  decumulationDefaultsInputSchema,
  decumulationOverrideArraySchema,
  lumpSumSchema,
  storedWithdrawalOrderSchema,
  storedWithdrawalSplitsSchema,
} from "@/lib/pure/engine/types";
import { buildStrategyParams } from "@/lib/pure/retirement/projection-settings";
import { engineProfileOptions } from "@/lib/pure/household/profile-selection";
import type { ProfileSelection } from "@/lib/pure/household/profile-selection.schema";
import { buildEnginePayload } from "@/server/services/projection/engine-payload/build-engine-payload";
import { fetchRetirementData } from "@/server/services/projection/engine-payload/load";
import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";

/**
 * The household's data and engine payload for a request's profile
 * selection and snapshot. The payload is returned as built (null,
 * notConfigured or ready): each caller keeps its own early returns.
 */
export async function prepareProjectionRun(
  { db, scope }: { db: Db; scope: RequestScope },
  request: { selection?: ProfileSelection; snapshotId?: number },
) {
  const profiles = engineProfileOptions(request.selection);
  const data = await fetchRetirementData(db, {
    snapshotId: request.snapshotId,
    contributionProfileId: profiles.contributionProfileId,
    salaryProfileId: profiles.salaryProfileId,
  });
  const payload = await buildEnginePayload(db, data, {
    ...profiles,
    asOf: scope.asOf,
  });
  return { profiles, data, payload };
}

// Accumulation/decumulation override schemas ("Changes by year") for every
// projection input. Omitted = the household's saved rows (resolveProjectionOverrides);
// only an editor with unsaved changes sends its own.
export const accumulationOverrideArraySchema = z.array(
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

/**
 * The payload's base input with the resolved decumulation defaults and the
 * "Changes by year" (omitted = the household's saved rows), in that order.
 */
export async function prepareEngineInput<Base extends object>(
  db: Db,
  payload: {
    settings: Parameters<typeof buildDecumulationDefaults>[0];
    distributionTaxRates: Parameters<typeof buildDecumulationDefaults>[2];
    baseEngineInput: Base;
  },
  input: Parameters<typeof resolveProjectionOverrides>[1] & {
    decumulationDefaults: Parameters<typeof buildDecumulationDefaults>[1];
  },
) {
  return {
    ...payload.baseEngineInput,
    decumulationDefaults: buildDecumulationDefaults(
      payload.settings,
      input.decumulationDefaults,
      payload.distributionTaxRates,
    ),
    ...((await resolveProjectionOverrides(db, input)) as {
      accumulationOverrides: AccumulationOverride[];
      decumulationOverrides: DecumulationOverride[];
    }),
  };
}
