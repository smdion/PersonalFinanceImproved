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
} from "../types";
import {
  getAllCategories,
  getAccountTypeConfig,
  buildCategoryRecord,
} from "../../config/account-types";

const ACCOUNT_CATEGORIES: AccountCategory[] = getAllCategories();

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
  }

  return config;
}
