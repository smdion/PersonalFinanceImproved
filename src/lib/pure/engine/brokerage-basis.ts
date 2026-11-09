/**
 * Brokerage cost basis per basis-tracking account; the aggregate is their sum. Money in adds
 * basis (`followInflows`), money out removes it at the account's ratio (`followDraws`), and
 * growth never changes basis.
 */
import { roundToCents } from "../../utils/math";
import {
  getAccountTypeConfig,
  isRetirementMoney,
} from "../../config/account-types";
import { setBasis } from "../../config/account-balance";
import type {
  AccountBalances,
  IndividualAccountInput,
  TaxBuckets,
} from "../accounts/account-balances.types";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";

export type BrokerageBasis = Map<string, number>;

/** Accounts whose balance structure tracks cost basis (brokerage). */
function basisTrackedAccounts(
  indAccounts: readonly IndividualAccountInput[],
): IndividualAccountInput[] {
  return indAccounts.filter(
    (ia) =>
      getAccountTypeConfig(ia.category).balanceStructure === "basis_tracking",
  );
}

/**
 * Starting basis per account: its own `startingBasis` (capped at balance); accounts without one
 * share the rest of the aggregate basis by starting balance.
 */
export function seedBrokerageBasis(
  indAccounts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  aggregateBasis: number,
): BrokerageBasis {
  const accounts = basisTrackedAccounts(indAccounts);
  const basis: BrokerageBasis = new Map();
  let known = 0;
  for (const ia of accounts) {
    if (ia.startingBasis == null) continue;
    const b = roundToCents(
      Math.max(0, Math.min(ia.startingBasis, Math.max(0, ia.startingBalance))),
    );
    basis.set(indKey(ia), b);
    known += b;
  }
  const missing = accounts.filter((ia) => ia.startingBasis == null);
  const rest = Math.max(0, aggregateBasis - known);
  const total = missing.reduce(
    (s, ia) => s + Math.max(0, ia.startingBalance),
    0,
  );
  for (const ia of missing)
    basis.set(
      indKey(ia),
      total > 0
        ? roundToCents(rest * (Math.max(0, ia.startingBalance) / total))
        : 0,
    );
  return basis;
}

/** Basis ÷ balance over the given accounts (0..1); undefined when they
 *  hold nothing (callers fall back to the aggregate ratio — a 0 would price
 *  any unattributed money as all gain). */
export function groupBasisRatio(
  accounts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  basis: BrokerageBasis,
): number | undefined {
  let balance = 0;
  let b = 0;
  for (const ia of basisTrackedAccounts(accounts)) {
    const k = indKey(ia);
    balance += Math.max(0, indBalance.get(k) ?? 0);
    b += basis.get(k) ?? 0;
  }
  return balance > 0 ? Math.min(1, Math.max(0, b / balance)) : undefined;
}

function brokerageBalances(
  indAccounts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
): Map<string, number> {
  return new Map(
    basisTrackedAccounts(indAccounts).map((ia) => [
      indKey(ia),
      Math.max(0, indBalance.get(indKey(ia)) ?? 0),
    ]),
  );
}

/** Run `mutate` (money out); any brokerage account whose balance fell
 *  gives up basis at its own ratio before the change. */
export function followDraws<T>(
  indAccounts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  basis: BrokerageBasis,
  mutate: () => T,
): T {
  const before = brokerageBalances(indAccounts, indKey, indBalance);
  const result = mutate();
  for (const [k, was] of before) {
    const now = Math.max(0, indBalance.get(k) ?? 0);
    if (now >= was || was <= 0) continue;
    const b = basis.get(k) ?? 0;
    basis.set(k, roundToCents(Math.max(0, b - (was - now) * (b / was))));
  }
  return result;
}

/** Run `mutate` (money in); every brokerage account's increase is new
 *  basis (cash contributed or reinvested). */
export function followInflows<T>(
  indAccounts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  basis: BrokerageBasis,
  mutate: () => T,
): T {
  const before = brokerageBalances(indAccounts, indKey, indBalance);
  const result = mutate();
  for (const [k, was] of before) {
    const now = Math.max(0, indBalance.get(k) ?? 0);
    if (now > was) basis.set(k, roundToCents((basis.get(k) ?? 0) + now - was));
  }
  return result;
}

/**
 * Runs the yearly reconciliation (`mutate`). Lowered accounts give up basis at their ratio;
 * raised ones receive the aggregate's basis surplus, by and at most their increase.
 */
export function followReconciliation<T>(
  indAccounts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  basis: BrokerageBasis,
  aggregateBasis: number,
  mutate: () => T,
): T {
  const before = brokerageBalances(indAccounts, indKey, indBalance);
  const result = followDraws(indAccounts, indKey, indBalance, basis, mutate);
  const raised = [...before]
    .map(([k, was]) => [k, Math.max(0, indBalance.get(k) ?? 0) - was] as const)
    .filter(([, inc]) => inc > 0);
  if (raised.length === 0) return result;
  let accountsBasis = 0;
  for (const k of before.keys()) accountsBasis += basis.get(k) ?? 0;
  const surplus = aggregateBasis - accountsBasis;
  if (surplus <= 0) return result;
  const totalInc = raised.reduce((s, [, inc]) => s + inc, 0);
  for (const [k, inc] of raised)
    basis.set(
      k,
      roundToCents(
        (basis.get(k) ?? 0) + Math.min(inc, surplus * (inc / totalInc)),
      ),
    );
  return result;
}

/**
 * Year end: basis is capped at balance, and when the accounts hold all brokerage money the
 * aggregate basis is their sum. Drift over $1 is surfaced as a diagnostic.
 */
export function syncAggregateBasis(
  indAccounts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  basis: BrokerageBasis,
  balances: TaxBuckets,
  accountBalance: AccountBalances,
  diagnostics: string[],
): void {
  const accounts = basisTrackedAccounts(indAccounts);
  if (accounts.length === 0) return;
  // The accounts' sum is the truth only when they hold all the brokerage
  // money; otherwise keep the aggregate's basis and say so rather than
  // price the rest as all gain.
  const held = accounts.reduce(
    (s, ia) => s + Math.max(0, indBalance.get(indKey(ia)) ?? 0),
    0,
  );
  if (Math.abs(held - balances.afterTax) > 1) {
    diagnostics.push(
      `[DIAG] brokerage basis: accounts hold $${held.toFixed(2)} of $${balances.afterTax.toFixed(2)} brokerage — aggregate basis kept`,
    );
    return;
  }
  let total = 0;
  const byCategory = new Map<string, number>();
  for (const ia of accounts) {
    const k = indKey(ia);
    const b = roundToCents(
      Math.min(basis.get(k) ?? 0, Math.max(0, indBalance.get(k) ?? 0)),
    );
    basis.set(k, b);
    total += b;
    byCategory.set(ia.category, (byCategory.get(ia.category) ?? 0) + b);
  }
  total = roundToCents(total);
  const drift = roundToCents(balances.afterTaxBasis - total);
  if (Math.abs(drift) > 1)
    diagnostics.push(
      `[DIAG] brokerage basis: aggregate $${balances.afterTaxBasis.toFixed(2)} vs accounts $${total.toFixed(2)} (drift $${drift.toFixed(2)})`,
    );
  balances.afterTaxBasis = Math.min(total, balances.afterTax);
  for (const [cat, b] of byCategory) {
    const balance = accountBalance[cat as keyof AccountBalances];
    if (balance.structure === "basis_tracking")
      setBasis(balance, roundToCents(Math.min(b, balance.balance)));
  }
}

/** Basis ratio for a retirement brokerage withdrawal: Retirement-parented brokerages' basis ÷
 *  balance. Undefined with no Retirement brokerage; callers then use the aggregate ratio. */
export function retirementBrokerageBasisRatio(
  indAccounts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  basis: BrokerageBasis,
): number | undefined {
  const accounts = basisTrackedAccounts(indAccounts).filter((ia) =>
    isRetirementMoney(ia.parentCategory),
  );
  return accounts.length > 0
    ? groupBasisRatio(accounts, indKey, indBalance, basis)
    : undefined;
}
