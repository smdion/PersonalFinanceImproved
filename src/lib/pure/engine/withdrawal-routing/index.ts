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
 * One dispatch to whichever mode config.withdrawalRoutingMode selects —
 * extracted verbatim from the earlier `routeForMode` body. No mode
 * function mutates `balances`, so `routeForMode`'s two-pass eligibility
 * gate (below) works by substituting which `balances`/`config` object this
 * receives, never by editing any of the three mode functions themselves.
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
  // Surface the same bracket ceiling `routeWithdrawalsBracketFilling` reports
  // as `traditionalCap` — previously
  // only bracket_filling mode populated this field, so waterfall + Roth-
  // bracket-overlay households never got a `bracketTraditionalCap` even
  // though the overlay was actively capping their withdrawals at exactly
  // this figure. `applyRothBracketOverlay` computes the identical
  // `computeBracketTraditionalCap(bracketInfo)` bracket_filling uses, AND
  // resets `withdrawalOrder` to force Traditional-first up to that cap
  // (see its own docblock) — the report narrative / table tooltip that cite
  // this figure describe the same real mechanism for waterfall as for
  // bracket_filling, so this is deliberately NOT mode-gated.
  // `routeConfig !== config` iff the overlay applied, which `applyRothBracketOverlay`
  // only does when this figure is finite — reusing that as the "did it apply" signal
  // instead of re-deriving the same null-check here.
  if (routeConfig !== config) {
    result.traditionalCap = computeBracketTraditionalCap(bracketInfo);
  }
  return result;
}

/**
 * True "last resort" semantics for the per-account penalty-allowance
 * override. Before this, a penalty-allowed
 * account's exposed dollars were never in the "still excluded" pool at all
 * — `subtractExcluded` never removed them, so they were ordinary balance,
 * drawable whenever `withdrawalOrder`/tax-preference ranking happened to
 * reach them, not held back until the household would otherwise be
 * genuinely short.
 *
 * Two dispatches:
 *
 * 1. Against balances with EVERYTHING penalty-exposed excluded — allowed
 *    accounts included (built by treating the FULL `penaltyExposedTrad/
 *    Roth/Total` figures as if they were the "still excluded" ones, reusing
 *    `subtractExcluded` unchanged). If this alone meets the need
 *    (`unmetNeed <= 0`), we're done — the allowed account is NEVER touched,
 *    which is the entire point of this pass. This is the important early return,
 *    not an optimization.
 * 2. Only when dispatch #1 leaves a real shortfall: the residual, against
 *    balances already reduced by dispatch #1's withdrawals
 *    (`applySlotsToBalances`) with JUST the penalty-allowed exposure folded back
 *    in (via the real `exposure` record's genuine "still excluded" fields —
 *    non-allowed exposure and non-retirement money stay excluded even
 *    though the household is short).
 *
 * Note this is a DIFFERENT, narrower two-pass model than the Tier B one
 * `routeForMode`'s docblock below says was deliberately collapsed to one
 * pass — that collapse was about the DEFAULT (no penalty allowance) case,
 * where "penalty-
 * exposed" and "excluded" were the same set and a second pass was pure
 * dead weight. Here the two sets genuinely differ (allowed vs. not), so a
 * second pass has real work to do only in the narrow case this function is
 * reached at all.
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

  // Replay pass 1's draws onto the ORIGINAL (unexcluded) balances, not
  // pass1Balances — pass1Balances had the allowed account zeroed out for
  // dispatch #1's purposes, and building pass 2 on top of that would leave
  // it zeroed forever, permanently discarding the exact money this
  // function exists to make reachable as a last resort. subtractExcluded
  // below is what re-applies the (narrower, real) exclusion for pass 2 —
  // still holding back genuinely non-allowed exposure and non-retirement
  // money, but no longer the allowed account.
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
 * Sum two dispatches' slots per category — dispatch #2 only ever runs
 * against the residual `unmetNeed` after dispatch #1, so a category drawn
 * in both passes had two SEPARATE, non-overlapping withdrawals from it, not
 * two conflicting answers to the same question. Both dispatches share the
 * same `config.withdrawalOrder`, so both slot arrays cover the same
 * categories — a category present in only one array (shouldn't happen, but
 * not assumed) is carried through unchanged. `remainingNeed` takes
 * dispatch #2's value — the true final figure, once both passes have run.
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
 * Route a withdrawal using whichever mode config.withdrawalRoutingMode
 * selects — the single dispatch point both the real decumulation-year
 * execution and withdrawal-solver.ts's estimate call, so a routing-mode-specific
 * rule (like the Roth-bracket overlay) can't be applied in one path and
 * forgotten in the other.
 *
 * `exposure` (supersedes the
 * Tier B two-pass model this function used to implement) — when provided,
 * `config.avoidPenalizedWithdrawals` is on, and something is actually
 * penalty-exposed, dispatches against balances with every penalty-exposed
 * dollar subtracted out. `nonRetirement` is the
 * same idea for Portfolio-parented ("not part of the retirement plan")
 * money — always excluded, no config lever, no opt-out. Both sources are
 * subtracted together in ONE dispatch (`subtractExcluded`) whenever either
 * has anything to exclude — there is no second pass for either. A
 * resulting `unmetNeed` is real — `penaltyAvoidedShortfall` and
 * `nonRetirementShortfall` each name how much of it is attributable to
 * their own exclusion (see `RouteResult`'s docblocks) rather than the
 * household being broke; a household can be short for either reason, both,
 * or neither. Falls through to a single unchanged `dispatchOnce` call
 * against the RAW balances whenever NEITHER source has anything to
 * exclude — that fallthrough (not a separately maintained branch) is what
 * keeps a household with nothing penalty-exposed AND nothing
 * Portfolio-parented (every household before that exclusion; every existing test
 * fixture), or a household with `avoidPenalizedWithdrawals: false` and no
 * Portfolio-parented accounts, byte-identical to output before that exclusion.
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
  // Does this household have penalty-exposed money in a penalty-"allowed"
  // account — i.e. real exposure that ISN'T in the "still excluded" pool
  // (which only counts non-allowed exposure)? If so, that money needs true
  // last-resort treatment: available only if the household is genuinely
  // short even after every OTHER source (including the still-excluded
  // exposure) is exhausted — see routeWithLastResortAllowance's docblock.
  // This subsumes penaltyExclusionActive's single-pass path whenever it's
  // true (dispatch #1 there also fully excludes the still-excluded pool),
  // so this branch takes priority.
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

  if (hasLastResortAllowance && exposure != null) {
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
  // Cap each against its own STILL-excluded/grand total, not a
  // blended figure — an allowed account's exposed dollars were never
  // excluded from this dispatch, and a real shortfall must never be
  // attributed to either source beyond what it actually excluded.
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
