/**
 * Sticky-forward per-field config resolution. The orchestrator resolves once per year and every
 * module receives resolved config, never raw override arrays.
 */
import type {
  AccumulationDefaults,
  AccumulationOverride,
  ResolvedAccumulationConfig,
} from "./types/accumulation";
import type {
  DecumulationDefaults,
  DecumulationOverride,
  ResolvedDecumulationConfig,
} from "./types/decumulation";
import type { AccountCategory } from "../../config/account-types";
import type { LumpSum } from "./types/year-overrides";
import {
  getAllCategories,
  getAccountTypeConfig,
  buildCategoryRecord,
  getDefaultDecumulationOrder,
} from "../../config/account-types";
import { RMD_SMOOTHING_MAX_BRACKET_TARGET_FALLBACK } from "../../constants";

/**
 * Appends any engine category missing from `withdrawalOrder` (the schema allows partial arrays,
 * which would strand balances) in `getDefaultDecumulationOrder()` order. Only on this resolution
 * path: routing called directly with a partial order still draws only what's listed.
 */
function ensureCompleteWithdrawalOrder(
  order: AccountCategory[],
): AccountCategory[] {
  const present = new Set(order);
  const missing = getDefaultDecumulationOrder().filter((c) => !present.has(c));
  return missing.length > 0 ? [...order, ...missing] : order;
}

/**
 * The year's accumulation config: sticky-forward overrides on the defaults, each field
 * independent; `reset: true` reverts all fields to defaults.
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
      for (const cat of getAllCategories()) {
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
    discretionaryWithdrawalOrder:
      defaults.discretionaryWithdrawalOrder ?? "roth_first",
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
        discretionaryWithdrawalOrder:
          defaults.discretionaryWithdrawalOrder ?? "roth_first",
      };
      continue;
    }

    if (o.withdrawalRoutingMode !== undefined)
      config.withdrawalRoutingMode = o.withdrawalRoutingMode;
    if (o.withdrawalOrder !== undefined)
      config.withdrawalOrder = [...o.withdrawalOrder];
    if (o.withdrawalSplits !== undefined) {
      for (const cat of getAllCategories()) {
        if (cat in o.withdrawalSplits) {
          config.withdrawalSplits[cat] =
            o.withdrawalSplits[cat] ?? config.withdrawalSplits[cat];
        }
      }
    }
    if (o.withdrawalTaxPreference !== undefined) {
      for (const cat of getAllCategories()) {
        if (cat in o.withdrawalTaxPreference) {
          config.withdrawalTaxPreference[cat] =
            o.withdrawalTaxPreference[cat] ?? null;
        }
      }
    }
    if (o.withdrawalAccountCaps !== undefined) {
      for (const cat of getAllCategories()) {
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
    // Sticky-forward and optional (decumulationOverrideArraySchema):
    // undefined means the plan default.
    if (o.rothBracketTarget !== undefined)
      config.rothBracketTarget = o.rothBracketTarget;
    // Seeded in the initial literal and reset branch; this sticky-forward
    // line lets it vary per year.
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
