/** The individual track at year end: each account's row, negatives clamped,
 *  basis clamped to the balance. */
import type {
  IndividualAccountYearBalance,
  IndividualAccountInput,
  AccountYearDraw,
  AccountYearRothBasis,
} from "../../accounts/account-balances.types";
import { roundToCents } from "../../../utils/math";
import { isOverflowTarget } from "../../../config/account-types";
import type { EligibilityRecord } from "@/lib/pure/accounts/eligibility";
import { accountIdKeyOf } from "@/lib/pure/accounts/account-part";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import {
  clampBasisToBalance,
  type RothBasisState,
  type BasisDraw,
} from "@/lib/pure/accounts/roth-basis-tracking";

/**
 * Builds each part's year record, in `indAccounts` order. `eligibility` (decumulation) passes
 * through lock state and reason; `maps.basis`/`maps.draws` fill the Roth basis fields.
 */
export function buildIndividualYearBalances(
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  indParentCat: Map<string, string>,
  phase: "accumulation" | "decumulation",
  maps: {
    contribs?: Map<string, number>;
    match?: Map<string, number>;
    growth?: Map<string, number>;
    withdrawal?: Map<string, number>;
    intentional?: Map<string, number>;
    overflow?: Map<string, number>;
    ramp?: Map<string, number>;
    basis?: Map<string, RothBasisState>;
    draws?: Map<string, BasisDraw>;
    /** Brokerage cost basis per account (brokerage-basis.ts). */
    brokerageBasis?: Map<string, number>;
  },
  eligibility?: EligibilityRecord,
): IndividualAccountYearBalance[] {
  const drawFor = (k: string): AccountYearDraw => {
    const accountEligibility = eligibility?.byKey.get(k);
    return {
      withdrawal: maps.withdrawal?.get(k) ?? 0,
      ...(accountEligibility
        ? {
            // "Locked" means every dollar is penalty-exposed; a partially
            // exposed account is not locked (eligibility.ts docblock).
            eligibilityLocked:
              accountEligibility.penaltyFreeAmount <= 0.005 &&
              accountEligibility.penaltyExposedAmount > 0,
            reason: accountEligibility.reason,
            // Start-of-year capacity (before this year's withdrawals and
            // growth) — the same numbers routing used.
            penaltyFreeAmount: accountEligibility.penaltyFreeAmount,
            penaltyExposedAmount: accountEligibility.penaltyExposedAmount,
            allowPenalizedWithdrawals:
              accountEligibility.allowPenalizedWithdrawals,
          }
        : {}),
    };
  };
  // The roth group, when this account has any of its fields.
  const rothFields = (roth: AccountYearRothBasis) =>
    Object.keys(roth).length > 0 ? { roth } : {};
  return indAccounts.map((ia): IndividualAccountYearBalance => {
    const k = indKey(ia);
    const isOverflow = isOverflowTarget(ia.category);
    const projectedFields =
      ia.origin === "projected" ? { projectedOnly: true } : {};
    const balance =
      Math.abs(indBalance.get(k) ?? 0) < 1
        ? 0
        : roundToCents(indBalance.get(k) ?? 0);
    const basisState = maps.basis?.get(k);
    const basisFields: AccountYearRothBasis = basisState
      ? {
          basisRemaining: roundToCents(
            basisState.contributionBasis + basisState.conversionBasis,
          ),
          contributionBasisRemaining: roundToCents(
            basisState.contributionBasis,
          ),
          conversionBasisRemaining: roundToCents(basisState.conversionBasis),
          basisUncertain: basisState.stale || basisState.isSeeded,
        }
      : {};
    const brokerageBasis = maps.brokerageBasis?.get(k);
    const costBasisFields =
      brokerageBasis != null ? { costBasis: roundToCents(brokerageBasis) } : {};
    const basisDraw = maps.draws?.get(k);
    const drawnFields: AccountYearRothBasis =
      basisDraw != null
        ? {
            basisDrawn: roundToCents(
              basisDraw.contributionDrawn + basisDraw.conversionDrawn,
            ),
          }
        : {};

    const part = {
      accountKey: accountIdKeyOf(ia),
      performanceAccountId: ia.performanceAccountId,
      name: ia.name,
      category: ia.category,
      taxType: ia.taxType,
      ownerName: ia.ownerName,
      ownerPersonId: ia.ownerPersonId,
      parentCategory: indParentCat.get(k),
      balance,
    };
    if (phase === "accumulation") {
      return {
        ...part,
        contribution: maps.contribs?.get(k) ?? 0,
        employerMatch: maps.match?.get(k) ?? 0,
        growth: maps.growth?.get(k) ?? 0,
        ...(isOverflow
          ? {
              intentionalContribution: maps.intentional?.get(k) ?? 0,
              overflowContribution: maps.overflow?.get(k) ?? 0,
              rampContribution: maps.ramp?.get(k) ?? 0,
            }
          : {}),
        ...costBasisFields,
        ...projectedFields,
        // A year a paycheck is gone draws too (gap-year-draw.ts): the same
        // draw, eligibility and basis fields a retirement year has.
        ...(maps.withdrawal ? { draw: drawFor(k) } : {}),
        ...rothFields(
          maps.withdrawal ? { ...basisFields, ...drawnFields } : basisFields,
        ),
      };
    }

    return {
      ...part,
      contribution: maps.contribs?.get(k) ?? 0,
      employerMatch: 0,
      growth: maps.growth?.get(k) ?? 0,
      draw: drawFor(k),
      ...rothFields({ ...basisFields, ...drawnFields }),
      ...costBasisFields,
      ...projectedFields,
    };
  });
}

/**
 * Clamp individual account balances to zero (rounding can create small negatives).
 * Mutates `indBalance` in place.
 */
export function clampIndividualBalances(
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
): void {
  for (const ia of indAccounts) {
    const k = indKey(ia);
    const v = indBalance.get(k) ?? 0;
    if (v < 0) indBalance.set(k, 0);
  }
}

/**
 * Clamps tracked Roth basis to each account's final (clamped, dust-cleaned) balance. Run after
 * balance clamping. Mutates `indBasis`.
 */
export function clampIndividualBasis(
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBasis: Map<string, RothBasisState>,
  indBalance: Map<string, number>,
): void {
  for (const ia of indAccounts) {
    const k = indKey(ia);
    const state = indBasis.get(k);
    if (!state) continue;
    const balance = Math.max(0, indBalance.get(k) ?? 0);
    indBasis.set(k, clampBasisToBalance(state, balance));
  }
}
