/**
 * applyLumpSums — apply one-time lump-sum injections to balances and per-account
 * tracking. Shared by the accumulation-year and decumulation-year handlers.
 */
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import type { LumpSum } from "../types/year-overrides";
import {
  getAccountTypeConfig,
  isRothType,
  isRetirementMoney,
} from "../../../config/account-types";
import {
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
} from "../../accounts/account-balance";
import type { ProjectionContext, ProjectionLoopState } from "./types";
import { portfolioFirst, retirementFirst } from "../individual-accounts/ledger";

/**
 * Apply one-time lump-sum injections for the current year.
 * Mutates `state.balances`, `state.accountBalance`, and `state.indBalance` in place.
 */
export function applyLumpSums(
  lumpSums: LumpSum[],
  ctx: ProjectionContext,
  state: ProjectionLoopState,
): void {
  const { hasIndividualAccounts, indAccounts, indKey } = ctx;
  const { balances, accountBalance, indBalance } = state;

  for (const ls of lumpSums) {
    const bs = getAccountTypeConfig(ls.targetAccount).balanceStructure;
    if (bs === "roth_traditional") {
      if (isRothType(ls.taxType ?? "")) {
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
    // Update individual account tracking for the lump sum
    if (hasIndividualAccounts) {
      const target = resolveLumpSumTarget(ls, indAccounts);
      if (target) {
        const key = indKey(target);
        indBalance.set(key, (indBalance.get(key) ?? 0) + ls.amount);
      }
    }
  }
}

/**
 * A lump sum's account: the named one (matching `targetOwnerName` when set, else first by name);
 * else by whose money it is (Brokerage page → Portfolio first, projection → Retirement first),
 * then matching tax type. Shared with Simple tax mode.
 */
export function resolveLumpSumTarget(
  ls: LumpSum,
  indAccounts: readonly IndividualAccountInput[],
): IndividualAccountInput | undefined {
  if (ls.targetAccountName)
    return (
      (ls.targetOwnerName
        ? indAccounts.find(
            (ia) =>
              ia.name === ls.targetAccountName &&
              ia.ownerName === ls.targetOwnerName,
          )
        : undefined) ??
      indAccounts.find((ia) => ia.name === ls.targetAccountName)
    );
  const bs = getAccountTypeConfig(ls.targetAccount).balanceStructure;
  const taxType =
    ls.taxType ??
    (bs === "single_bucket"
      ? "hsa"
      : bs === "roth_traditional"
        ? "preTax"
        : "afterTax");
  const parentOf = (ia: IndividualAccountInput) => ia.parentCategory;
  const byParent = (accounts: readonly IndividualAccountInput[]) => {
    if (isRetirementMoney(ls.targetParentCategory))
      return retirementFirst(accounts, parentOf);
    // Portfolio savings never go to the projection-only account unless
    // there's nowhere else for them.
    const real = accounts.filter((ia) => !ia.projectedOnly);
    return real.length > 0 ? portfolioFirst(real, parentOf) : [...accounts];
  };
  return (
    byParent(
      indAccounts.filter(
        (ia) => ia.category === ls.targetAccount && ia.taxType === taxType,
      ),
    )[0] ??
    byParent(indAccounts.filter((ia) => ia.category === ls.targetAccount))[0]
  );
}
