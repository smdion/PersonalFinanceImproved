/** A projection run: its household data and engine payload, and the engine
 *  input built from them ("Changes by year" and decumulation defaults). */

import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { toNumber } from "@/lib/utils/numbers";
import * as schema from "@/lib/db/schema";
import { readStoredStrategy } from "@/lib/db/stored-strategy-key";
import { readStoredValue } from "@/lib/db/stored-setting";
import { readStoredShape, storedValueLog } from "@/lib/db/stored-shape";
import { WITHDRAWAL_ROUTING_MODES } from "@/lib/config/withdrawal-routing";
import {
  accountCategoryEnum,
  getDefaultDecumulationOrder,
  isKnownCategory,
  DEFAULT_WITHDRAWAL_SPLITS as CONFIG_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import {
  knownCategoryList,
  knownCategoryRecord,
  unknownCategoryNote,
  unknownLumpSumTargetNotes,
  type UnknownTargetLumpSum,
} from "@/lib/pure/accounts/tax-buckets/unknown-type-rows";
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
    // Per-category fields set only some categories (the engine's Partial).
    accountSplits: z
      .partialRecord(z.enum(accountCategoryEnum()), z.number())
      .optional(),
    taxSplits: z
      .partialRecord(z.enum(accountCategoryEnum()), z.number().min(0).max(1))
      .optional(),
    accountCaps: z
      .partialRecord(z.enum(accountCategoryEnum()), z.number())
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
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Each kind's per-category fields: lists and records of account categories. */
const CATEGORY_FIELDS = {
  accumulation: ["accountOrder", "accountSplits", "taxSplits", "accountCaps"],
  decumulation: [
    "withdrawalOrder",
    "withdrawalSplits",
    "withdrawalAccountCaps",
    "withdrawalTaxPreference",
  ],
} as const;

/** What `withKnownCategories` drops: a note per category left out of a
 *  row's fields, and each lump sum left out (`unknownLumpSumTargetNotes`). */
type CategoryDrops = { notes: string[]; lumpSums: UnknownTargetLumpSum[] };

/** A saved row with each unknown account type dropped from its fields (a list
 *  emptied is removed: the row sets none) and each lump sum to one left out,
 *  into `drops`; anything else as stored, for its shape's check (FALLBACKS). */
function withKnownCategories(
  row: unknown,
  fields: readonly string[],
  drops: CategoryDrops,
): unknown {
  if (!isRecord(row)) return row;
  const year = String(row.year);
  const kept: Record<string, unknown> = { ...row };
  for (const field of fields) {
    const value = row[field];
    const read = Array.isArray(value)
      ? knownCategoryList(value)
      : isRecord(value)
        ? knownCategoryRecord(value)
        : null;
    if (read === null || read.unknown.length === 0) continue;
    if (Array.isArray(read.known) && read.known.length === 0)
      delete kept[field];
    else kept[field] = read.known;
    for (const category of read.unknown)
      drops.notes.push(
        unknownCategoryNote(category, `Changes by year for ${year}`),
      );
  }
  if (Array.isArray(row.lumpSums))
    kept.lumpSums = row.lumpSums.filter((lumpSum: unknown) => {
      if (!isRecord(lumpSum)) return true;
      const { targetAccount: category, amount } = lumpSum;
      if (typeof category !== "string" || isKnownCategory(category))
        return true;
      drops.lumpSums.push({ year, category, amount });
      return false;
    });
  return kept;
}

/** The household's saved set of one kind, parsed after `withKnownCategories`
 *  (its drops in `drops`); a set its schema still refuses (the save path
 *  stores any records) is dropped, logged once (FALLBACKS). */
async function savedOverrides<S extends z.ZodType>(
  db: Db,
  overrideType: "accumulation" | "decumulation",
  shape: S,
  drops: CategoryDrops,
): Promise<z.output<S> | []> {
  const rows = await db
    .select({ overrides: schema.projectionOverrides.overrides })
    .from(schema.projectionOverrides)
    .where(eq(schema.projectionOverrides.overrideType, overrideType));
  const stored: unknown = rows[0]?.overrides ?? [];
  const dropped: CategoryDrops = { notes: [], lumpSums: [] };
  const read = readStoredShape(
    Array.isArray(stored)
      ? stored.map((row: unknown) =>
          withKnownCategories(row, CATEGORY_FIELDS[overrideType], dropped),
        )
      : stored,
    shape,
    storedValueLog(`projection_overrides.${overrideType}`),
  );
  if (!read.fits) return [];
  drops.notes.push(...dropped.notes);
  drops.lumpSums.push(...dropped.lumpSums);
  // The parsed copy (unnamed keys stripped), as the engine has always had.
  return shape.parse(read.value);
}

/** The "Changes by year" every projection runs with (relocation and the
 *  strategy comparison too), as engine types: what the caller sent, else
 *  the household's saved sets (`savedOverrides`, its notes in `notes`). */
export async function resolveProjectionOverrides(
  db: Db,
  input: {
    accumulationOverrides?: z.infer<typeof accumulationOverrideArraySchema>;
    decumulationOverrides?: z.infer<typeof decumulationOverrideArraySchema>;
  },
  notes: string[] = [],
): Promise<{
  accumulationOverrides: AccumulationOverride[];
  decumulationOverrides: DecumulationOverride[];
}> {
  // Each kind's drops apart, then in this order whichever read ends first.
  const kinds: [CategoryDrops, CategoryDrops] = [
    { notes: [], lumpSums: [] },
    { notes: [], lumpSums: [] },
  ];
  const [accumulationOverrides, decumulationOverrides] = await Promise.all([
    input.accumulationOverrides ??
      savedOverrides(
        db,
        "accumulation",
        accumulationOverrideArraySchema,
        kinds[0],
      ),
    input.decumulationOverrides ??
      savedOverrides(
        db,
        "decumulation",
        decumulationOverrideArraySchema,
        kinds[1],
      ),
  ]);
  notes.push(
    ...kinds.flatMap((k) => k.notes),
    ...unknownLumpSumTargetNotes(kinds.flatMap((k) => k.lumpSums)),
  );
  return { accumulationOverrides, decumulationOverrides };
}

/** retirement_settings' withdrawal routing, as its writer stores it. */
const storedRouting = z.looseObject({
  withdrawalRoutingMode: z.enum(WITHDRAWAL_ROUTING_MODES),
  withdrawalOrder: storedWithdrawalOrderSchema.nullish(),
  withdrawalSplits: storedWithdrawalSplitsSchema.nullish(),
});

/** retirement_settings' saved withdrawal order and splits as the projection
 *  and the Retirement page read them: each account type this version doesn't
 *  know dropped and named (FALLBACKS); another shape as stored. */
export function knownSavedRouting(settings: {
  withdrawalOrder?: string[] | null;
  withdrawalSplits?: Record<string, number> | null;
}) {
  const order = Array.isArray(settings.withdrawalOrder)
    ? knownCategoryList(settings.withdrawalOrder)
    : null;
  const splits = isRecord(settings.withdrawalSplits)
    ? knownCategoryRecord(settings.withdrawalSplits)
    : null;
  return {
    withdrawalOrder: order ? order.known : settings.withdrawalOrder,
    withdrawalSplits: splits ? splits.known : settings.withdrawalSplits,
    unknownInOrder: order?.unknown ?? [],
    unknownInSplits: splits?.unknown ?? [],
  };
}

/**
 * Build decumulation defaults from DB settings + client-supplied routing overrides.
 * Shared by computeProjection and computeSimulation. A saved order or splits
 * the run reads (the client sent none) notes each category it drops in `notes`.
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
  notes: string[] = [],
): DecumulationDefaults {
  const known = knownSavedRouting(settings);
  const saved = readStoredValue(
    "retirement_settings",
    {
      ...settings,
      withdrawalOrder: known.withdrawalOrder,
      withdrawalSplits: known.withdrawalSplits,
    },
    storedRouting,
  );
  if (clientDefaults.withdrawalOrder === undefined)
    for (const category of known.unknownInOrder)
      notes.push(unknownCategoryNote(category, "the saved withdrawal order"));
  if (clientDefaults.withdrawalSplits === undefined)
    for (const category of known.unknownInSplits)
      notes.push(unknownCategoryNote(category, "the saved withdrawal splits"));
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
    avoidPenalizedWithdrawals: clientDefaults.avoidPenalizedWithdrawals,
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

/** The base's input warnings with `notes` after them (each once); nothing
 *  when there are no notes, so the base's keys stay as built. */
function inputWarningsWith(base: object, notes: readonly string[]) {
  if (notes.length === 0) return {};
  const before: unknown = "inputWarnings" in base ? base.inputWarnings : [];
  const kept = Array.isArray(before)
    ? before.filter((w): w is string => typeof w === "string")
    : [];
  return { inputWarnings: [...kept, ...new Set(notes)] };
}

/**
 * The payload's base input with the resolved decumulation defaults and the
 * "Changes by year" (omitted = the household's saved rows), in that order;
 * the input warnings name each saved account type they drop.
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
  const notes: string[] = [];
  const decumulationDefaults = buildDecumulationDefaults(
    payload.settings,
    input.decumulationDefaults,
    payload.distributionTaxRates,
    notes,
  );
  const overrides = await resolveProjectionOverrides(db, input, notes);
  return {
    ...payload.baseEngineInput,
    ...inputWarningsWith(payload.baseEngineInput, notes),
    decumulationDefaults,
    ...overrides,
  };
}
