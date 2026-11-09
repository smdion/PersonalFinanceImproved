/** Routing's caps: the bracket cap, caps left after a pass, past-target. */
import type { DecumulationSlot } from "../types/routing";
import type { ResolvedDecumulationConfig } from "../types/decumulation";
import { roundToCents } from "../../../utils/math";
import { incomeCapForMarginalRate } from "../tax-estimation";
import type { RouteBracketInfo } from "./types";

/** The year went past the bracket target: the target is a preference, so
 *  spending was funded, and this says what it cost the plan. */
export function pastTargetWarning(amount: number): string {
  return `$${Math.round(amount).toLocaleString()} went past your bracket target, because the other accounts couldn't cover the year's spending.`;
}

/** The household's own caps, less what an earlier pass already drew: a
 *  yearly cap covers the year, not each pass. */
export function capsLeftAfter(
  config: ResolvedDecumulationConfig,
  slots: readonly DecumulationSlot[],
): ResolvedDecumulationConfig {
  const left = (cap: number | null, drawn: number) =>
    cap === null ? null : roundToCents(Math.max(0, cap - drawn));
  const drawn = (key: "traditionalWithdrawal" | "rothWithdrawal") =>
    slots.reduce((t, s) => t + s[key], 0);
  return {
    ...config,
    withdrawalAccountCaps: Object.fromEntries(
      Object.entries(config.withdrawalAccountCaps).map(([cat, cap]) => [
        cat,
        left(cap, slots.find((s) => s.category === cat)?.withdrawal ?? 0),
      ]),
    ) as ResolvedDecumulationConfig["withdrawalAccountCaps"],
    withdrawalTaxTypeCaps: {
      ...config.withdrawalTaxTypeCaps,
      traditional: left(
        config.withdrawalTaxTypeCaps.traditional,
        drawn("traditionalWithdrawal"),
      ),
      roth: left(config.withdrawalTaxTypeCaps.roth, drawn("rothWithdrawal")),
    },
  };
}

/**
 * Dollar cap on Traditional withdrawals/conversions that keeps ordinary income in
 * the `rothBracketTarget` bracket: its gross ceiling minus SS already in it.
 * Infinity when there is no bracket data or target.
 */
export function computeBracketTraditionalCap(
  bracketInfo: RouteBracketInfo,
): number {
  if (
    !bracketInfo.taxBrackets ||
    bracketInfo.taxBrackets.length === 0 ||
    bracketInfo.rothBracketTarget == null
  ) {
    return Infinity;
  }
  const incomeCap = incomeCapForMarginalRate(
    bracketInfo.rothBracketTarget,
    bracketInfo.taxBrackets,
    bracketInfo.standardDeduction,
  );
  return roundToCents(Math.max(0, incomeCap - bracketInfo.taxableSS));
}
