/**
 * applyLumpSums — apply one-time lump-sum injections to balances and per-account
 * tracking. Shared by the accumulation-year and decumulation-year handlers.
 */
import type { LumpSum } from "../types/year-overrides";
import {
  getAccountTypeConfig,
  isTaxFreeBucket,
} from "../../../config/account-types";
import { taxTypeOnSide } from "../../../config/tax-treatment-buckets";
import {
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
} from "../../accounts/account-balance";
import type { ProjectionContext, ProjectionLoopState } from "./types";
import { lumpSumParts, runLumpSums } from "../lump-sum-targets";
import { roundToCents } from "../../../utils/math";
import { equalShares, inflowShares } from "../individual-accounts/part-weights";

/**
 * Apply one-time lump-sum injections for the current year.
 * Mutates `state.balances`, `state.accountBalance`, and `state.indBalance` in place.
 */
export function applyLumpSums(
  lumpSums: readonly LumpSum[],
  ctx: ProjectionContext,
  state: ProjectionLoopState,
): void {
  const { holdsAccounts, indAccounts, indKey, lumpSumTargets } = ctx;
  const { balances, accountBalance, indBalance } = state;

  for (const ls of runLumpSums(lumpSums, lumpSumTargets)) {
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
    // Its parts take it, by balance when its target is no single part
    if (holdsAccounts) {
      const targets = lumpSumParts(ls, indAccounts);
      const shares = inflowShares(
        targets.map((ia) => Math.max(0, indBalance.get(indKey(ia)) ?? 0)),
        equalShares(targets.length),
      );
      let left = ls.amount;
      targets.forEach((ia, i) => {
        const share =
          i === targets.length - 1
            ? left
            : roundToCents(ls.amount * shares[i]!);
        left = roundToCents(left - share);
        const key = indKey(ia);
        indBalance.set(key, (indBalance.get(key) ?? 0) + share);
      });
    }
  }
}
