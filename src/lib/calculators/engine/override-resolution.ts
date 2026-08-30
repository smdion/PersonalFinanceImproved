/**
 * Override Resolution — sticky-forward per-field config resolution.
 *
 * Cross-cutting infrastructure: every downstream module receives resolved
 * config from this module, never raw override arrays. The orchestrator calls
 * these once per year, then passes the result through to all modules.
 */
import type {
  AccumulationDefaults,
  AccumulationOverride,
  ResolvedAccumulationConfig,
  DecumulationDefaults,
  DecumulationOverride,
  ResolvedDecumulationConfig,
  AccountCategory,
  LumpSum,
} from "../types";
import {
  getAllCategories,
  getAccountTypeConfig,
  buildCategoryRecord,
  getEngineCategories,
  DEFAULT_DECUMULATION_ORDER,
} from "../../config/account-types";
import { RMD_SMOOTHING_MAX_BRACKET_TARGET_FALLBACK } from "../../constants";

const ACCOUNT_CATEGORIES: AccountCategory[] = getAllCategories();

/**
 * Guarantee `withdrawalOrder` covers every engine category, appending any
 * that are missing (advisor review, 2026-08-29, v0.7.10 R51 Gap A round 2
 * finding 7). `withdrawalOrder` is validated with no completeness/
 * uniqueness constraint (`_shared.ts`'s zod schema is a bare
 * `z.array(z.enum(...))`) and replaced wholesale on override
 * (`config.withdrawalOrder = [...o.withdrawalOrder]` below) — a partial
 * array reaches the engine intact otherwise, silently stranding real
 * balance in whichever category got left out (waterfall's category loop
 * only ever visits what's listed; bracket_filling's Phase 1 now does too,
 * see `withdrawal-routing.ts`'s `phase1Order`).
 *
 * Deliberately scoped to THIS function only, not a universal invariant on
 * `ResolvedDecumulationConfig` itself: `tests/calculators/
 * withdrawal-routing.test.ts` constructs partial orders directly
 * (bypassing `resolveDecumulationConfig` entirely) and asserts routing
 * draws ONLY from what's listed — a real, intentional "restrict to these
 * accounts" contract for that construction path, not a bug. Backfilling
 * here protects every config that actually reaches the engine through the
 * real resolution path (the UI's order editor always covers every
 * category in practice) without touching that separate, deliberately
 * partial test contract.
 *
 * Missing categories are appended in `DEFAULT_DECUMULATION_ORDER`'s
 * relative order — deterministic, and matches what an un-customized
 * household already sees for those same categories.
 */
function ensureCompleteWithdrawalOrder(
  order: AccountCategory[],
): AccountCategory[] {
  const present = new Set(order);
  const missing = DEFAULT_DECUMULATION_ORDER.filter(
    (c) => getEngineCategories().includes(c) && !present.has(c),
  );
  return missing.length > 0 ? [...order, ...missing] : order;
}

/**
 * Resolve the accumulation config for a given year by applying sticky-forward
 * overrides on top of the page-level defaults.
 *
 * Each field in AccumulationOverride is independent — setting contributionRate
 * in one override doesn't affect taxSplits from a previous override.
 * A `reset: true` override reverts ALL fields to defaults.
 */
export function resolveAccumulationConfig(
  year: number,
  defaults: AccumulationDefaults,
  overrides: AccumulationOverride[],
): ResolvedAccumulationConfig {
  // Start from defaults
  let config: ResolvedAccumulationConfig = {
    contributionRate: defaults.contributionRate,
    routingMode: defaults.routingMode,
    accountOrder: [...defaults.accountOrder],
    accountSplits: { ...defaults.accountSplits },
    taxSplits: { ...defaults.taxSplits },
    accountCaps: buildCategoryRecord(() => null),
    taxTypeCaps: { traditional: null, roth: null },
    lumpSums: [],
  };

  // Apply overrides in year order (they should already be sorted)
  for (const o of overrides) {
    if (o.year > year) break;

    if (o.reset) {
      // Reset ALL fields to defaults
      config = {
        contributionRate: defaults.contributionRate,
        routingMode: defaults.routingMode,
        accountOrder: [...defaults.accountOrder],
        accountSplits: { ...defaults.accountSplits },
        taxSplits: { ...defaults.taxSplits },
        accountCaps: buildCategoryRecord(() => null),
        taxTypeCaps: { traditional: null, roth: null },
        lumpSums: [],
      };
      continue;
    }

    // Apply each field independently (sticky-forward)
    if (o.contributionRate !== undefined)
      config.contributionRate = o.contributionRate;
    if (o.routingMode !== undefined) config.routingMode = o.routingMode;
    if (o.accountOrder !== undefined) config.accountOrder = [...o.accountOrder];
    if (o.accountSplits !== undefined) {
      config.accountSplits = {
        ...config.accountSplits,
        ...o.accountSplits,
      };
    }
    if (o.taxSplits !== undefined) {
      config.taxSplits = {
        ...config.taxSplits,
        ...o.taxSplits,
      };
    }
    if (o.accountCaps !== undefined) {
      // Merge partial caps — explicitly set null to remove a cap
      for (const cat of ACCOUNT_CATEGORIES) {
        if (cat in o.accountCaps) {
          config.accountCaps[cat] = o.accountCaps[cat] ?? null;
        }
      }
    }
    if (o.taxTypeCaps !== undefined) {
      if ("traditional" in o.taxTypeCaps) {
        config.taxTypeCaps.traditional = o.taxTypeCaps.traditional ?? null;
      }
      if ("roth" in o.taxTypeCaps) {
        config.taxTypeCaps.roth = o.taxTypeCaps.roth ?? null;
      }
    }
  }

  // Lump sums: exact-year match only (NOT sticky-forward)
  config.lumpSums = overrides
    .filter((o) => o.year === year && o.lumpSums?.length)
    .flatMap((o) => o.lumpSums as LumpSum[]);

  return config;
}

/**
 * Resolve the decumulation config for a given year.
 * Same sticky-forward logic as accumulation.
 */
export function resolveDecumulationConfig(
  year: number,
  defaults: DecumulationDefaults,
  overrides: DecumulationOverride[],
): ResolvedDecumulationConfig {
  const defaultSplits =
    defaults.withdrawalSplits ?? buildCategoryRecord(() => 0);

  let config: ResolvedDecumulationConfig = {
    withdrawalRate: defaults.withdrawalRate,
    withdrawalRoutingMode: defaults.withdrawalRoutingMode ?? "bracket_filling",
    withdrawalOrder: [...defaults.withdrawalOrder],
    withdrawalSplits: { ...defaultSplits },
    withdrawalTaxPreference: Object.fromEntries(
      getAllCategories().map((cat) => [
        cat,
        getAccountTypeConfig(cat).supportsRothSplit
          ? (defaults.withdrawalTaxPreference[cat] ?? null)
          : null,
      ]),
    ) as Record<AccountCategory, "traditional" | "roth" | null>,
    withdrawalAccountCaps: buildCategoryRecord(() => null),
    withdrawalTaxTypeCaps: { traditional: null, roth: null },
    lumpSums: [],
    avoidPenalizedWithdrawals: defaults.avoidPenalizedWithdrawals ?? true,
    rmdExcessHandling: defaults.rmdExcessHandling ?? "reinvest",
    qcdMaximize: defaults.qcdMaximize ?? false,
    rmdSmoothingEnabled: defaults.rmdSmoothingEnabled ?? false,
    rmdSmoothingMaxBracketTarget:
      defaults.rmdSmoothingMaxBracketTarget ??
      RMD_SMOOTHING_MAX_BRACKET_TARGET_FALLBACK,
  };

  for (const o of overrides) {
    if (o.year > year) break;

    if (o.reset) {
      config = {
        withdrawalRate: defaults.withdrawalRate,
        withdrawalRoutingMode:
          defaults.withdrawalRoutingMode ?? "bracket_filling",
        withdrawalOrder: [...defaults.withdrawalOrder],
        withdrawalSplits: { ...defaultSplits },
        withdrawalTaxPreference: Object.fromEntries(
          getAllCategories().map((cat) => [
            cat,
            getAccountTypeConfig(cat).supportsRothSplit
              ? (defaults.withdrawalTaxPreference[cat] ?? null)
              : null,
          ]),
        ) as Record<AccountCategory, "traditional" | "roth" | null>,
        withdrawalAccountCaps: buildCategoryRecord(() => null),
        withdrawalTaxTypeCaps: { traditional: null, roth: null },
        lumpSums: [],
        avoidPenalizedWithdrawals: defaults.avoidPenalizedWithdrawals ?? true,
        rmdExcessHandling: defaults.rmdExcessHandling ?? "reinvest",
        qcdMaximize: defaults.qcdMaximize ?? false,
        rmdSmoothingEnabled: defaults.rmdSmoothingEnabled ?? false,
        rmdSmoothingMaxBracketTarget:
          defaults.rmdSmoothingMaxBracketTarget ??
          RMD_SMOOTHING_MAX_BRACKET_TARGET_FALLBACK,
      };
      continue;
    }

    if (o.withdrawalRate !== undefined)
      config.withdrawalRate = o.withdrawalRate;
    if (o.withdrawalRoutingMode !== undefined)
      config.withdrawalRoutingMode = o.withdrawalRoutingMode;
    if (o.withdrawalOrder !== undefined)
      config.withdrawalOrder = [...o.withdrawalOrder];
    if (o.withdrawalSplits !== undefined) {
      for (const cat of ACCOUNT_CATEGORIES) {
        if (cat in o.withdrawalSplits) {
          config.withdrawalSplits[cat] =
            o.withdrawalSplits[cat] ?? config.withdrawalSplits[cat];
        }
      }
    }
    if (o.withdrawalTaxPreference !== undefined) {
      for (const cat of ACCOUNT_CATEGORIES) {
        if (cat in o.withdrawalTaxPreference) {
          config.withdrawalTaxPreference[cat] =
            o.withdrawalTaxPreference[cat] ?? null;
        }
      }
    }
    if (o.withdrawalAccountCaps !== undefined) {
      for (const cat of ACCOUNT_CATEGORIES) {
        if (cat in o.withdrawalAccountCaps) {
          config.withdrawalAccountCaps[cat] =
            o.withdrawalAccountCaps[cat] ?? null;
        }
      }
    }
    if (o.withdrawalTaxTypeCaps !== undefined) {
      if ("traditional" in o.withdrawalTaxTypeCaps) {
        config.withdrawalTaxTypeCaps.traditional =
          o.withdrawalTaxTypeCaps.traditional ?? null;
      }
      if ("roth" in o.withdrawalTaxTypeCaps) {
        config.withdrawalTaxTypeCaps.roth =
          o.withdrawalTaxTypeCaps.roth ?? null;
      }
    }
    if (o.rothConversionTarget !== undefined)
      config.rothConversionTarget = o.rothConversionTarget;
    // Added 2026-08-29 — see DecumulationOverride's docblock. Same
    // optional/sticky-forward pattern as rothConversionTarget just above:
    // no entry needed in the initial literal or the reset branch (an
    // omitted optional field is already undefined, which is the correct
    // "use the plan default" value for rothBracketTarget).
    if (o.rothBracketTarget !== undefined)
      config.rothBracketTarget = o.rothBracketTarget;
    // rmdSmoothingMaxBracketTarget itself is NOT new (already seeded in
    // both the initial literal above and the reset branch, always
    // resolved) — only this sticky-forward apply line is new, letting a
    // household/search vary it per year instead of it being fixed for
    // the whole plan.
    if (o.rmdSmoothingMaxBracketTarget !== undefined)
      config.rmdSmoothingMaxBracketTarget = o.rmdSmoothingMaxBracketTarget;
    if (o.avoidPenalizedWithdrawals !== undefined)
      config.avoidPenalizedWithdrawals = o.avoidPenalizedWithdrawals;
  }

  // Lump sums: exact-year match only (NOT sticky-forward)
  config.lumpSums = overrides
    .filter((o) => o.year === year && o.lumpSums?.length)
    .flatMap((o) => o.lumpSums as LumpSum[]);

  config.withdrawalOrder = ensureCompleteWithdrawalOrder(
    config.withdrawalOrder,
  );

  return config;
}
