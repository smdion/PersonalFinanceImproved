/** One group of account parts pushed onto its category's balance
 *  (`reconcileIndividualToAggregate`, reconcile.ts). */
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import { roundToCents } from "../../../utils/math";
import { isRetirementMoney } from "../../../config/account-types";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { equalShares, inflowShares } from "./part-weights";

/** One (category, tax-slice) group's reconciliation: retirement money absorbs the drift, and a
 *  shortfall takes from Portfolio only once it is empty. With no weight, left alone. */
export function reconcileGroup(
  groupAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  target: number,
  label: string,
  diagnostics: string[],
): void {
  if (groupAccounts.length === 0) return;
  const balance = (ia: IndividualAccountInput) =>
    Math.max(0, indBalance.get(indKey(ia)) ?? 0);
  const sumOf = (accounts: IndividualAccountInput[]) =>
    accounts.reduce((s, ia) => s + balance(ia), 0);
  const sumInd = sumOf(groupAccounts);
  const delta = roundToCents(target - sumInd);
  if (delta === 0) return;

  if (Math.abs(delta) > 1) {
    diagnostics.push(
      `[DIAG] indBal/acctBal reconciliation: ${label} drifted by $${delta.toFixed(2)} (indBal sum $${sumInd.toFixed(2)} vs acctBal $${target.toFixed(2)})`,
    );
  }

  const retirement = groupAccounts.filter((ia) =>
    isRetirementMoney(ia.parentCategory),
  );
  const portfolio = groupAccounts.filter(
    (ia) => !isRetirementMoney(ia.parentCategory),
  );

  // `amount` by balance, else equally if `equalWhenEmpty`; returns the unplaced.
  const spread = (
    accounts: IndividualAccountInput[],
    amount: number,
    equalWhenEmpty: boolean,
  ): number => {
    if (accounts.length === 0 || amount === 0) return amount;
    if (sumOf(accounts) <= 0 && !equalWhenEmpty) return amount;
    const shares = inflowShares(
      accounts.map(balance),
      equalShares(accounts.length),
    );
    let distributed = 0;
    let largestKey: string | null = null;
    let largestBalance = -Infinity;
    for (const [i, ia] of accounts.entries()) {
      const k = indKey(ia);
      const b = balance(ia);
      if (b > largestBalance) {
        largestBalance = b;
        largestKey = k;
      }
      const share = roundToCents(amount * shares[i]!);
      const newBalance = Math.max(0, roundToCents(b + share));
      indBalance.set(k, newBalance);
      distributed += roundToCents(newBalance - b);
    }
    const residual = roundToCents(amount - distributed);
    if (residual !== 0 && largestKey) {
      const b = Math.max(0, indBalance.get(largestKey) ?? 0);
      const newBalance = Math.max(0, roundToCents(b + residual));
      indBalance.set(largestKey, newBalance);
      return roundToCents(residual - (newBalance - b));
    }
    return 0;
  };

  let unplaced: number;
  if (portfolio.length === 0 || retirement.length === 0) {
    unplaced = spread(groupAccounts, delta, false);
  } else if (delta > 0) {
    unplaced = spread(retirement, delta, true);
  } else {
    // Retirement money first, the remainder from Portfolio.
    const fromRetirement = Math.max(delta, -sumOf(retirement));
    const left = spread(retirement, fromRetirement, false);
    unplaced = spread(
      portfolio,
      roundToCents(delta - fromRetirement + left),
      false,
    );
  }

  if (unplaced !== 0 && sumOf(groupAccounts) <= 0 && target > 0) {
    // No weight to distribute by — inventing one would be a second
    // allocation policy. Leave indBalance alone; the diagnostic above (for
    // >$1 drift) already surfaces this if it's material.
    if (Math.abs(delta) <= 1) {
      diagnostics.push(
        `[DIAG] indBal/acctBal reconciliation: ${label} has $${target.toFixed(2)} in acctBal but no individual-account balance to distribute it across — left unreconciled`,
      );
    }
  }
}
