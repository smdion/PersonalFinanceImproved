/** Withdrawal routing: routeForMode dispatches each year's withdrawal to its
 *  mode (waterfall.ts, percentage.ts, bracket-filling.ts). Every router
 *  receives ResolvedDecumulationConfig, never raw overrides. */
import type { DecumulationSlot } from "../types/routing";
import type { ResolvedDecumulationConfig } from "../types/decumulation";
import type { AccountBalances } from "../../accounts/account-balances.types";
import type { AccountCategory } from "../../../config/account-types";
import { roundToCents } from "../../../utils/math";
import { subtractExcluded, applySlotsToBalances } from "../balance-utils";
import type {
  EligibilityRecord,
  NonRetirementExclusion,
} from "@/lib/pure/accounts/eligibility";
import { routeWithdrawals } from "./waterfall";
import { routeWithdrawalsPercentage } from "./percentage";
import {
  capsLeftAfter,
  computeBracketTraditionalCap,
  pastTargetWarning,
} from "./caps";
import { routeWithdrawalsBracketFilling } from "./bracket-filling";
import type { RouteBracketInfo, RouteResult } from "./types";
import { applyRothBracketOverlay } from "./roth-bracket-overlay";

/**
 * One dispatch to the mode config.withdrawalRoutingMode selects. Mode functions
 * never mutate `balances`; `routeForMode` gates eligibility by what it passes in.
 */
function dispatchOnce(
  targetWithdrawal: number,
  config: ResolvedDecumulationConfig,
  balances: AccountBalances,
  bracketInfo: RouteBracketInfo,
): RouteResult {
  if (config.withdrawalRoutingMode === "bracket_filling") {
    return routeWithdrawalsBracketFilling(
      targetWithdrawal,
      config,
      balances,
      bracketInfo,
    );
  }
  if (config.withdrawalRoutingMode === "percentage") {
    return routeWithdrawalsPercentage(targetWithdrawal, config, balances);
  }
  // Waterfall mode — apply Roth bracket optimization overlay if configured.
  const routeConfig = applyRothBracketOverlay(config, bracketInfo);
  let result = routeWithdrawals(targetWithdrawal, routeConfig, balances);
  // The target is a preference, not a limit on spending. Every other account
  // has had its turn above; what's left comes from what the target held back,
  // in the household's own order, under only their own caps.
  if (routeConfig !== config && (result.unmetNeed ?? 0) > 0) {
    const beyond = routeWithdrawals(
      result.unmetNeed!,
      capsLeftAfter(config, result.slots),
      applySlotsToBalances(balances, result.slots),
    );
    const funded = roundToCents(result.unmetNeed! - (beyond.unmetNeed ?? 0));
    result = {
      slots: mergeDecumulationSlots(result.slots, beyond.slots),
      warnings: [
        ...result.warnings.filter((w) => !w.includes("unmet")),
        ...beyond.warnings,
        ...(funded > 0 ? [pastTargetWarning(funded)] : []),
      ],
      unmetNeed: beyond.unmetNeed,
    };
  }
  // The overlay caps waterfall withdrawals at the same bracket ceiling, so report
  // it as `traditionalCap` too. `routeConfig !== config` iff the overlay applied,
  // which happens only when this figure is finite.
  if (routeConfig !== config) {
    result.traditionalCap = computeBracketTraditionalCap(bracketInfo);
  }
  return result;
}

/**
 * Penalty-allowed accounts as a true last resort: dispatch #1 excludes all
 * penalty-exposed money; only a shortfall runs dispatch #2 on the residual, with
 * just the allowed exposure folded back in (other exclusions still hold).
 */
function routeWithLastResortAllowance(
  targetWithdrawal: number,
  config: ResolvedDecumulationConfig,
  balances: AccountBalances,
  bracketInfo: RouteBracketInfo,
  exposure: EligibilityRecord,
  nonRetirement: NonRetirementExclusion | undefined,
): RouteResult {
  const fullExclusion: EligibilityRecord = {
    ...exposure,
    penaltyExposedTradStillExcluded: exposure.penaltyExposedTrad,
    penaltyExposedRothStillExcluded: exposure.penaltyExposedRoth,
    penaltyExposedTotalStillExcluded: exposure.penaltyExposedTotal,
    totalPenaltyExposedStillExcluded: exposure.totalPenaltyExposed,
  };
  const pass1Balances = subtractExcluded(
    balances,
    fullExclusion,
    nonRetirement,
  );
  const pass1 = dispatchOnce(
    targetWithdrawal,
    config,
    pass1Balances,
    bracketInfo,
  );

  if (pass1.unmetNeed == null || pass1.unmetNeed <= 0) {
    return pass1;
  }

  // Replay pass 1's draws on the unexcluded balances: pass1Balances has the
  // allowed account zeroed. subtractExcluded then re-applies only the real
  // exclusion (non-allowed exposure, non-retirement money).
  const pass1ResultBalances = applySlotsToBalances(balances, pass1.slots);
  const pass2Balances = subtractExcluded(
    pass1ResultBalances,
    exposure,
    nonRetirement,
  );
  const pass2 = dispatchOnce(
    pass1.unmetNeed,
    capsLeftAfter(config, pass1.slots),
    pass2Balances,
    bracketInfo,
  );

  const finalUnmetNeed = pass2.unmetNeed;
  const penaltyAvoidedShortfall =
    finalUnmetNeed != null && finalUnmetNeed > 0
      ? roundToCents(
          Math.min(finalUnmetNeed, exposure.totalPenaltyExposedStillExcluded),
        )
      : undefined;
  const nonRetirementShortfall =
    finalUnmetNeed != null && finalUnmetNeed > 0 && nonRetirement
      ? roundToCents(Math.min(finalUnmetNeed, nonRetirement.grandTotal))
      : undefined;

  return {
    slots: mergeDecumulationSlots(pass1.slots, pass2.slots),
    warnings: [...pass1.warnings, ...pass2.warnings],
    unmetNeed: finalUnmetNeed,
    // Dispatch #2's value — it always ran to reach this line, and it's the
    // one computed against the TRUE final routing (allowed money included).
    traditionalCap: pass2.traditionalCap,
    tierBreakdown: [
      ...(pass1.tierBreakdown ?? []),
      ...(pass2.tierBreakdown ?? []),
    ],
    rothBasisCapacity: pass2.rothBasisCapacity,
    brokerageZeroLtcgCapacity: pass2.brokerageZeroLtcgCapacity,
    ...(penaltyAvoidedShortfall != null ? { penaltyAvoidedShortfall } : {}),
    ...(nonRetirementShortfall != null ? { nonRetirementShortfall } : {}),
  };
}

/**
 * Sums two dispatches' slots per category (dispatch #2 draws only the residual,
 * so they never overlap); a category in one array only carries through.
 * `remainingNeed` is dispatch #2's, the final figure.
 */
function mergeDecumulationSlots(
  pass1: DecumulationSlot[],
  pass2: DecumulationSlot[],
): DecumulationSlot[] {
  const byCategory = new Map<AccountCategory, DecumulationSlot>(
    pass1.map((s) => [s.category, s]),
  );
  for (const s2 of pass2) {
    const s1 = byCategory.get(s2.category);
    if (!s1) {
      byCategory.set(s2.category, s2);
      continue;
    }
    byCategory.set(s2.category, {
      category: s2.category,
      withdrawal: roundToCents(s1.withdrawal + s2.withdrawal),
      rothWithdrawal: roundToCents(s1.rothWithdrawal + s2.rothWithdrawal),
      traditionalWithdrawal: roundToCents(
        s1.traditionalWithdrawal + s2.traditionalWithdrawal,
      ),
      cappedByAccount: s1.cappedByAccount || s2.cappedByAccount,
      cappedByTaxType: s1.cappedByTaxType || s2.cappedByTaxType,
      remainingNeed: s2.remainingNeed,
    });
  }
  return Array.from(byCategory.values());
}

/**
 * The single routing entry for the real year and the solver's estimate. Excludes
 * penalty-exposed money (when avoided) and Portfolio-parented money in one
 * dispatch; the shortfall fields say how much `unmetNeed` each exclusion caused.
 */
export function routeForMode(
  targetWithdrawal: number,
  config: ResolvedDecumulationConfig,
  balances: AccountBalances,
  bracketInfo: RouteBracketInfo,
  exposure?: EligibilityRecord,
  nonRetirement?: NonRetirementExclusion,
): RouteResult {
  const penaltyExclusionActive =
    exposure != null &&
    exposure.totalPenaltyExposedStillExcluded !== 0 &&
    config.avoidPenalizedWithdrawals;
  const nonRetirementExclusionActive =
    nonRetirement != null && nonRetirement.grandTotal !== 0;
  // Penalty-exposed money in an allowed account (outside the still-excluded pool)
  // is a last resort. That path also excludes the still-excluded pool, so it
  // takes priority over the single-pass exclusion.
  const hasLastResortAllowance =
    exposure != null &&
    config.avoidPenalizedWithdrawals &&
    exposure.totalPenaltyExposed !== exposure.totalPenaltyExposedStillExcluded;

  if (
    !penaltyExclusionActive &&
    !nonRetirementExclusionActive &&
    !hasLastResortAllowance
  ) {
    return dispatchOnce(targetWithdrawal, config, balances, bracketInfo);
  }

  if (hasLastResortAllowance) {
    return routeWithLastResortAllowance(
      targetWithdrawal,
      config,
      balances,
      bracketInfo,
      exposure,
      nonRetirementExclusionActive ? nonRetirement : undefined,
    );
  }

  const excludedBalances = subtractExcluded(
    balances,
    penaltyExclusionActive ? exposure : undefined,
    nonRetirementExclusionActive ? nonRetirement : undefined,
  );
  const result = dispatchOnce(
    targetWithdrawal,
    config,
    excludedBalances,
    bracketInfo,
  );
  if (result.unmetNeed == null || result.unmetNeed <= 0) return result;
  // Cap each at what its own exclusion removed (still-excluded or grand total),
  // never a blended figure.
  const penaltyAvoidedShortfall = penaltyExclusionActive
    ? roundToCents(
        Math.min(result.unmetNeed, exposure.totalPenaltyExposedStillExcluded),
      )
    : undefined;
  const nonRetirementShortfall = nonRetirementExclusionActive
    ? roundToCents(Math.min(result.unmetNeed, nonRetirement.grandTotal))
    : undefined;
  return {
    ...result,
    ...(penaltyAvoidedShortfall != null ? { penaltyAvoidedShortfall } : {}),
    ...(nonRetirementShortfall != null ? { nonRetirementShortfall } : {}),
  };
}
