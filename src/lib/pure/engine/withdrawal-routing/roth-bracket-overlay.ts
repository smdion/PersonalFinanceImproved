/** The Roth-bracket overlay on a waterfall config. */
import type { ResolvedDecumulationConfig } from "../types/decumulation";
import {
  categoriesWithTaxPreference,
  getDefaultDecumulationOrder,
} from "../../../config/account-types";
import { computeBracketTraditionalCap } from "./caps";
import type { RouteBracketInfo } from "./types";

/**
 * Roth-bracket overlay for waterfall, when on: caps Traditional withdrawals at the target bracket
 * and forces Traditional on unset Roth-split categories. Else (or no bracket data) the same config.
 */
export function applyRothBracketOverlay(
  config: ResolvedDecumulationConfig,
  bracketInfo: RouteBracketInfo,
): ResolvedDecumulationConfig {
  if (
    !config.rothBracketOverlay ||
    bracketInfo.rothBracketTarget == null ||
    !bracketInfo.taxBrackets ||
    bracketInfo.taxBrackets.length === 0
  ) {
    return config;
  }
  const rothOptTraditionalCap = computeBracketTraditionalCap(bracketInfo);
  // Negated "< Infinity", not ">= Infinity", so a NaN cap takes the no-overlay
  // path (NaN comparisons are always false).
  if (!(rothOptTraditionalCap < Infinity)) return config;

  const existingTradCap = config.withdrawalTaxTypeCaps.traditional;
  const tradOverrides = Object.fromEntries(
    categoriesWithTaxPreference()
      .filter((cat) => config.withdrawalTaxPreference[cat] === null)
      .map((cat) => [cat, "traditional" as const]),
  );
  return {
    ...config,
    withdrawalTaxTypeCaps: {
      ...config.withdrawalTaxTypeCaps,
      traditional:
        existingTradCap !== null
          ? Math.min(rothOptTraditionalCap, existingTradCap)
          : rothOptTraditionalCap,
    },
    withdrawalTaxPreference: {
      ...config.withdrawalTaxPreference,
      ...tradOverrides,
    },
    // Required: with the user's order, a non-Traditional category ahead of
    // Traditional consumes the need before the cap binds, making the overlay a
    // no-op. The default order draws Traditional first.
    withdrawalOrder: getDefaultDecumulationOrder(),
  };
}
