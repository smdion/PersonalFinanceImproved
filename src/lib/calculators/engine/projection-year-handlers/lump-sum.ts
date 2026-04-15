/**
 * applyLumpSums — apply one-time lump-sum injections to balances and per-account
 * tracking. Extracted from accumulation-year.ts:411-450 and decumulation-year.ts:401-439,
 * which were byte-identical. Pure relocation — no logic changes.
 *
 * v0.5.3 refactor B2.
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
      const target = ls.targetAccountName
        ? indAccts.find((ia) => ia.name === ls.targetAccountName)
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
