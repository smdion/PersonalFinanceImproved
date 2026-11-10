/** The per-account ledger (`indBalance`, composite key → balance): keys,
 *  credits, the year's growth and tracked Roth basis. */
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import { roundToCents } from "../../../utils/math";
import {
  getAccountTypeConfig,
  isRetirementMoney,
} from "../../../config/account-types";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import {
  accrueContributionBasis,
  drawFromBasis,
  applyBasisDraw,
  type RothBasisState,
  type BasisDraw,
} from "@/lib/pure/accounts/roth-basis-tracking";

/** The inverse of retirementFirst: Portfolio-parented items first, every
 *  item when there are none — for Portfolio money (the Brokerage page's
 *  contribution ramp and lump sums). */
export function portfolioFirst<T>(
  items: readonly T[],
  parentOf: (item: T) => string | undefined,
): T[] {
  const portfolio = items.filter((x) => !isRetirementMoney(parentOf(x)));
  return portfolio.length > 0 ? portfolio : [...items];
}

/**
 * Retirement money first: items that aren't Portfolio-parented, or all items when none are.
 * Retirement-routed money must land where retirement spending can withdraw it.
 */
export function retirementFirst<T>(
  items: readonly T[],
  parentOf: (item: T) => string | undefined,
): T[] {
  const retirement = items.filter((x) => isRetirementMoney(parentOf(x)));
  return retirement.length > 0 ? retirement : [...items];
}

/** The standard composite key. Includes `ownerPersonId`, so two people's same-named accounts
 *  stay apart (eligibility is per owner too); a joint account keys on `"joint"`. */
export function makeIndKey(): IndKeyFn {
  return (ia) =>
    `${ia.name}::${ia.category}::${ia.taxType}::${ia.ownerPersonId ?? "joint"}`;
}

/** Adds `amount` to account `account` in each of the year's maps `into`
 *  (its contributions, balance, and the source the amount came from). */
export function credit(
  account: string,
  amount: number,
  into: Map<string, number>[],
): void {
  for (const map of into) map.set(account, (map.get(account) ?? 0) + amount);
}

/** Creates spec key from contribution spec fields. */
export function specKeyOf(spec: {
  name: string;
  personId?: number | null;
  taxTreatment: string;
}): string {
  return spec.personId != null
    ? `${spec.name}::${spec.personId}::${spec.taxTreatment}`
    : `${spec.name}::${spec.taxTreatment}`;
}

/**
 * Apply growth to individual account balances.
 * Mutates `indBalance` in place. Returns per-account growth amounts.
 */
export function applyIndividualGrowth(
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  effectiveReturn: number,
  clampNegative: boolean = false,
): Map<string, number> {
  const growthMap = new Map<string, number>();
  for (const ia of indAccounts) {
    const k = indKey(ia);
    const prevBalance = clampNegative
      ? Math.max(0, indBalance.get(k) ?? 0)
      : (indBalance.get(k) ?? 0);
    const growth = roundToCents(prevBalance * effectiveReturn);
    growthMap.set(k, growth);
    indBalance.set(k, roundToCents(prevBalance + growth));
  }
  return growthMap;
}

// Tracked Roth basis: thin per-account loops that branch on rothOrderingRules
// and delegate all basis math to @/lib/pure/accounts/roth-basis-tracking.

/**
 * Grows tracked basis by this year's contributions (`indContributions` excludes employer match).
 * Mutates `indBasis`; accounts with no entry (non-Roth) are skipped.
 */
export function accrueIndividualBasis(
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBasis: Map<string, RothBasisState>,
  indContributions: Map<string, number>,
): void {
  for (const ia of indAccounts) {
    const k = indKey(ia);
    const state = indBasis.get(k);
    if (!state) continue;
    const contribution = indContributions.get(k) ?? 0;
    indBasis.set(k, accrueContributionBasis(state, contribution));
  }
}

/**
 * Depletes tracked basis by the basis share of each withdrawal (`rothOrderingRules`). Run after
 * `distributeWithdrawals`. Mutates `indBasis`; returns the `BasisDraw`s (`roth.basisDrawn`).
 */
export function depleteIndividualBasis(input: {
  indAccounts: IndividualAccountInput[];
  indKey: IndKeyFn;
  indBasis: Map<string, RothBasisState>;
  preWithdrawalBalance: Map<string, number>;
  withdrawals: Map<string, number>;
}): Map<string, BasisDraw> {
  const { indAccounts, indKey, indBasis, preWithdrawalBalance, withdrawals } =
    input;
  const draws = new Map<string, BasisDraw>();
  for (const ia of indAccounts) {
    const k = indKey(ia);
    const state = indBasis.get(k);
    if (!state) continue;
    const withdrawal = withdrawals.get(k) ?? 0;
    if (withdrawal <= 0) continue;
    const orderingRule = getAccountTypeConfig(ia.category).rothOrderingRules;
    if (orderingRule !== "basis_first" && orderingRule !== "pro_rata") continue;
    const draw = drawFromBasis({
      state,
      orderingRule,
      balanceBeforeWithdrawal: preWithdrawalBalance.get(k) ?? 0,
      withdrawal,
    });
    draws.set(k, draw);
    indBasis.set(k, applyBasisDraw(state, draw));
  }
  return draws;
}
