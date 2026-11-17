/**
 * applyLumpSums — apply one-time lump-sum injections to balances and per-account
 * tracking. Shared by the accumulation-year and decumulation-year handlers.
 */
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import type { LumpSum } from "../types/year-overrides";
import {
  getAccountTypeConfig,
  getDisplayConfig,
  isTaxFreeBucket,
  isRetirementMoney,
} from "../../../config/account-types";
import { taxTypeOnSide } from "../../../config/tax-treatment-buckets";
import {
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
} from "../../accounts/account-balance";
import type { ProjectionContext, ProjectionLoopState } from "./types";
import { isHeldPart } from "../../accounts/account-part";
import { portfolioFirst, retirementFirst } from "../individual-accounts/ledger";
import { roundToCents, safeDivide, sumBy } from "../../../utils/math";

/**
 * Apply one-time lump-sum injections for the current year.
 * Mutates `state.balances`, `state.accountBalance`, and `state.indBalance` in place.
 */
export function applyLumpSums(
  lumpSums: LumpSum[],
  ctx: ProjectionContext,
  state: ProjectionLoopState,
): void {
  const { holdsAccounts, indAccounts, indKey } = ctx;
  const { balances, accountBalance, indBalance } = state;

  for (const ls of lumpSums) {
    const bs = getAccountTypeConfig(ls.targetAccount).balanceStructure;
    if (bs === "roth_traditional") {
      if (isTaxFreeBucket(taxTypeOnSide(ls.targetAccount, ls.taxType))) {
        balances.taxFree += ls.amount;
        addRoth(accountBalance[ls.targetAccount], ls.amount);
      } else {
        balances.preTax += ls.amount;
        addTraditional(accountBalance[ls.targetAccount], ls.amount);
      }
    } else if (bs === "single_bucket") {
      balances.hsa += ls.amount;
      addBalance(accountBalance[ls.targetAccount], ls.amount);
    } else {
      // basis_tracking (brokerage)
      balances.afterTax += ls.amount;
      balances.afterTaxBasis += ls.amount;
      addBalance(accountBalance[ls.targetAccount], ls.amount);
      addBasis(accountBalance[ls.targetAccount], ls.amount);
    }
    // Its parts take it, by balance when a name resolved to none
    if (holdsAccounts) {
      const targets = resolveLumpSumTargets(ls, indAccounts);
      const balanceOf = (ia: IndividualAccountInput) =>
        Math.max(0, indBalance.get(indKey(ia)) ?? 0);
      const total = sumBy(targets, balanceOf);
      let left = ls.amount;
      targets.forEach((ia, i) => {
        const share =
          i === targets.length - 1
            ? left
            : roundToCents(
                ls.amount *
                  safeDivide(balanceOf(ia), total, 1 / targets.length),
              );
        left = roundToCents(left - share);
        const key = indKey(ia);
        indBalance.set(key, (indBalance.get(key) ?? 0) + share);
      });
    }
  }
}

/**
 * A lump sum's parts, of its category and tax type, ordered by whose money it is (its parent; unset:
 * Retirement first; Portfolio money skips the projection-only part while another exists): the
 * named one, else (a name none carries) the first parent's, shared by balance; unnamed, the first.
 */
export function resolveLumpSumTargets(
  ls: LumpSum,
  indAccounts: readonly IndividualAccountInput[],
): IndividualAccountInput[] {
  const taxType = taxTypeOnSide(ls.targetAccount, ls.taxType);
  const parts = indAccounts.filter(
    (ia) => ia.category === ls.targetAccount && ia.taxType === taxType,
  );
  const parentOf = (ia: IndividualAccountInput) => ia.parentCategory;
  const real = parts.filter((ia) => ia.origin !== "projected");
  const ordered = isRetirementMoney(ls.targetParentCategory)
    ? retirementFirst(parts, parentOf)
    : real.length > 0
      ? portfolioFirst(real, parentOf)
      : parts;
  const first = ordered[0];
  if (!ls.targetAccountName || !first) return ordered.slice(0, 1);
  const named = parts.filter((ia) => ia.name === ls.targetAccountName);
  const owned = named.find((ia) => ia.ownerName === ls.targetOwnerName);
  if (ls.targetOwnerName && owned) return [owned];
  if (named.length > 0) return [named[0]!];
  return ordered.filter(
    (ia) =>
      isRetirementMoney(ia.parentCategory) ===
      isRetirementMoney(first.parentCategory),
  );
}

/** Each lump sum with no account part of its category and tax type: the
 *  totals take it, no account's row can, so the run says so. */
export function unplacedLumpSumWarnings(
  overrides: readonly { year: number; lumpSums?: LumpSum[] }[],
  accounts: readonly IndividualAccountInput[],
): string[] {
  if (!accounts.some(isHeldPart)) return [];
  return overrides.flatMap(({ year, lumpSums }) =>
    (lumpSums ?? [])
      .filter((ls) => resolveLumpSumTargets(ls, accounts).length === 0)
      .map((ls) => {
        const label = getDisplayConfig(ls.targetAccount).displayLabel;
        const amount = Math.round(ls.amount).toLocaleString();
        return `${year}: a $${amount} lump sum for ${label} has no ${label} account to land in, so no account's row shows it.`;
      }),
  );
}
