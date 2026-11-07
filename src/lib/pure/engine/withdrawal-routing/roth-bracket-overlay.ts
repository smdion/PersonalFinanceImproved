/** The Roth-bracket overlay on a waterfall config. */
import type { ResolvedDecumulationConfig } from "../types/decumulation";
import {
  categoriesWithTaxPreference,
  getDefaultDecumulationOrder,
} from "../../../config/account-types";
import { computeBracketTraditionalCap } from "./caps";
import type { RouteBracketInfo } from "./types";

/**
 * Apply the Roth-bracket-optimization overlay to a waterfall config: caps
 * cross-account traditional withdrawals at the income level that keeps the
 * target marginal bracket, and forces traditional preference on Roth-split
 * categories the user hasn't explicitly set a preference on. No-op (returns
 * the same config) when no rothBracketTarget is configured or there's no
 * bracket data to compute a cap from.
 */
export function applyRothBracketOverlay(
  config: ResolvedDecumulationConfig,
  bracketInfo: RouteBracketInfo,
): ResolvedDecumulationConfig {
  if (
    bracketInfo.rothBracketTarget == null ||
    !bracketInfo.taxBrackets ||
    bracketInfo.taxBrackets.length === 0
  ) {
    return config;
  }
  const rothOptTraditionalCap = computeBracketTraditionalCap(bracketInfo);
  // Written as a negation of "< Infinity" (not ">= Infinity") so a NaN cap
  // (shouldn't happen, but taxableSS/incomeCap are computed values) takes
  // the same no-overlay path as the original inline logic did — NaN
  // comparisons are always false either way, but ">=" would silently flip
  // which branch that lands on.
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
    // Confirmed load-bearing, NOT an oversight: this overlay adds a Traditional
    // tax-type cap above so the "Roth bracket optimization" this overlay
    // implements means anything in waterfall mode, `routeWithdrawals`'s
    // category loop still runs in the user's OWN configured order. If
    // that order puts a non-Traditional category (e.g. brokerage) ahead
    // of every Traditional-preference one, `remaining` gets consumed
    // before the cap ever binds, making the whole overlay a near-no-op —
    // confirmed against 3 real engine-snapshot fixtures that exercise
    // exactly this combination. Resetting to the default order guarantees
    // Traditional actually gets drawn first, which is the entire point of
    // this overlay. Do not remove without its own dedicated behavior-
    // change PR and tests, separate from any other withdrawalOrder fix.
    withdrawalOrder: getDefaultDecumulationOrder(),
  };
}
