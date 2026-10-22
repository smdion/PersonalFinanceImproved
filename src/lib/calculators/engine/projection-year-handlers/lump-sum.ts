/**
 * applyLumpSums — apply one-time lump-sum injections to balances and per-account
 * tracking. Shared by the accumulation-year and decumulation-year handlers,
 * which previously carried byte-identical copies.
 */
import type { IndividualAccountInput, LumpSum } from "../../types";
import {
  getAccountTypeConfig,
  isRothType,
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
  isRetirementMoney,
} from "../../../config/account-types";
import type { ProjectionContext, ProjectionLoopState } from "./types";
import {
  portfolioFirst,
  retirementFirst,
} from "../individual-account-tracking";

/**
 * Apply one-time lump-sum injections for the current year.
 * Mutates `state.balances`, `state.acctBal`, and `state.indBal` in place.
 */
export function applyLumpSums(
  lumpSums: LumpSum[],
  ctx: ProjectionContext,
  state: ProjectionLoopState,
): void {
  const { hasIndividualAccounts, indAccts, indKey } = ctx;
  const { balances, acctBal, indBal } = state;

  for (const ls of lumpSums) {
    const bs = getAccountTypeConfig(ls.targetAccount).balanceStructure;
    if (bs === "roth_traditional") {
      if (isRothType(ls.taxType ?? "")) {
        balances.taxFree += ls.amount;
        addRoth(acctBal[ls.targetAccount], ls.amount);
      } else {
        balances.preTax += ls.amount;
        addTraditional(acctBal[ls.targetAccount], ls.amount);
      }
    } else if (bs === "single_bucket") {
      balances.hsa += ls.amount;
      addBalance(acctBal[ls.targetAccount], ls.amount);
    } else {
      // basis_tracking (brokerage)
      balances.afterTax += ls.amount;
      balances.afterTaxBasis += ls.amount;
      addBalance(acctBal[ls.targetAccount], ls.amount);
      addBasis(acctBal[ls.targetAccount], ls.amount);
    }
    // Update individual account tracking for the lump sum
    if (hasIndividualAccounts) {
      const target = resolveLumpSumTarget(ls, indAccts);
      if (target) {
        const key = indKey(target);
        indBal.set(key, (indBal.get(key) ?? 0) + ls.amount);
      }
    }
  }
}

/**
 * The individual account a lump sum lands in. A named account wins: name
 * AND owner when the lump sum carries `targetOwnerName` (two people can
 * have an identically named account), else the first by name — lump sums
 * saved before that field existed. With no account named, by whose money
 * it is: the Brokerage page's are Portfolio savings (Portfolio accounts
 * first), the retirement projection's stay retirement money (Retirement
 * accounts first — the projection-only retirement brokerage included, so
 * with no real Retirement brokerage it doesn't become Portfolio money).
 * Within the category, the matching tax type first. Shared with Simple tax
 * mode, which keeps only lump sums that land in retirement money.
 */
export function resolveLumpSumTarget(
  ls: LumpSum,
  indAccts: readonly IndividualAccountInput[],
): IndividualAccountInput | undefined {
  if (ls.targetAccountName)
    return (
      (ls.targetOwnerName
        ? indAccts.find(
            (ia) =>
              ia.name === ls.targetAccountName &&
              ia.ownerName === ls.targetOwnerName,
          )
        : undefined) ?? indAccts.find((ia) => ia.name === ls.targetAccountName)
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
  const byParent = (accts: readonly IndividualAccountInput[]) => {
    if (isRetirementMoney(ls.targetParentCategory))
      return retirementFirst(accts, parentOf);
    // Portfolio savings never go to the projection-only account unless
    // there's nowhere else for them.
    const real = accts.filter((ia) => !ia.projectedOnly);
    return real.length > 0 ? portfolioFirst(real, parentOf) : [...accts];
  };
  return (
    byParent(
      indAccts.filter(
        (ia) => ia.category === ls.targetAccount && ia.taxType === taxType,
      ),
    )[0] ??
    byParent(indAccts.filter((ia) => ia.category === ls.targetAccount))[0]
  );
}
