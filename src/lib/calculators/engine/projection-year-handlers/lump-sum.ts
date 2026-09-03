/**
 * applyLumpSums — apply one-time lump-sum injections to balances and per-account
 * tracking. Shared by the accumulation-year and decumulation-year handlers,
 * which previously carried byte-identical copies.
 */
import type { LumpSum } from "../../types";
import {
  getAccountTypeConfig,
  isRothType,
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
} from "../../../config/account-types";
import type { ProjectionContext, ProjectionLoopState } from "./types";

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
      const taxType =
        ls.taxType ??
        (bs === "single_bucket"
          ? "hsa"
          : bs === "roth_traditional"
            ? "preTax"
            : "afterTax");
      // Match by name AND owner when the lump sum was created
      // after targetOwnerName existed — falls back to name-only for lump
      // sums saved before that field existed, or when the household has
      // never had two people share an account name (the common case, where
      // both match paths agree). Two household members with an
      // identically-named account (e.g. both "Long Term Brokerage") used to
      // silently collide here, always landing on whichever account
      // `indAccts` happened to list first.
      const target = ls.targetAccountName
        ? ((ls.targetOwnerName
            ? indAccts.find(
                (ia) =>
                  ia.name === ls.targetAccountName &&
                  ia.ownerName === ls.targetOwnerName,
              )
            : undefined) ??
          indAccts.find((ia) => ia.name === ls.targetAccountName))
        : (indAccts.find(
            (ia) => ia.category === ls.targetAccount && ia.taxType === taxType,
          ) ?? indAccts.find((ia) => ia.category === ls.targetAccount));
      if (target) {
        const key = indKey(target);
        indBal.set(key, (indBal.get(key) ?? 0) + ls.amount);
      }
    }
  }
}
