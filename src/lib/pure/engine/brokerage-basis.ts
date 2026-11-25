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
import type { AccountCategory } from "../../config/account-types";
import type { AccountBalance } from "../../config/account-types.types";
import { getBasis, setBasis } from "../accounts/account-balance";
import type {
  AccountBalances,
  IndividualAccountInput,
  TaxBuckets,
} from "../accounts/account-balances.types";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";

export type BrokerageBasis = Map<string, number>;

/** Average cost (IRC § 1012): the basis a draw of `amount` takes from money whose basis ÷ balance
 *  is `ratio`, unrounded. Uncapped, so money holding more basis than balance gives it up in
 *  proportion and an emptied account keeps none. */
export function basisOut(amount: number, ratio: number): number {
  return amount * ratio;
}

/** A draw's taxable gain once `out` (its basis out, in cents) is taken: never below 0, the one
 *  place the ratio caps at 1. */
function taxableGain(amount: number, out: number): number {
  return roundToCents(amount - Math.min(amount, out));
}

/** A brokerage sale of `amount` at basis ÷ balance `ratio`: the basis it takes out (cents), the
 *  part of the sale that returns basis, and the taxable gain. */
export function sellAtCost(amount: number, ratio: number) {
  const out = roundToCents(basisOut(amount, ratio));
  return {
    basisOut: out,
    basisPortion: Math.min(amount, out),
    gainsPortion: taxableGain(amount, out),
  };
}

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
 * Starting basis per account: its own `startingBasis` (none on a $0 account); accounts without one
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
    const b =
      ia.startingBalance > 0 ? roundToCents(Math.max(0, ia.startingBasis)) : 0;
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

/** Basis ÷ balance over the given accounts (average cost, uncapped); undefined when they
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
  return balance > 0 ? Math.max(0, b / balance) : undefined;
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
    basis.set(k, roundToCents(Math.max(0, b - basisOut(was - now, b / was))));
  }
  return result;
}

/** The basis each category's brokerage accounts hold, unrounded. */
function basisByCategory(
  accounts: readonly IndividualAccountInput[],
  keyOf: IndKeyFn,
  basis: BrokerageBasis,
): Map<AccountCategory, number> {
  const held = new Map<AccountCategory, number>();
  for (const account of basisTrackedAccounts(accounts)) {
    const b = basis.get(keyOf(account)) ?? 0;
    held.set(account.category, (held.get(account.category) ?? 0) + b);
  }
  return held;
}

/** `followDraws`, also returning the basis each category's accounts gave up,
 *  to the cent: what the category and the tax buckets give up with them. */
export function followDrawsSold<T>(
  accounts: readonly IndividualAccountInput[],
  keyOf: IndKeyFn,
  balances: Map<string, number>,
  basis: BrokerageBasis,
  mutate: () => T,
): { result: T; sold: Map<AccountCategory, number> } {
  const before = basisByCategory(accounts, keyOf, basis);
  const result = followDraws(accounts, keyOf, balances, basis, mutate);
  const after = basisByCategory(accounts, keyOf, basis);
  const sold = new Map<AccountCategory, number>();
  for (const [category, was] of before)
    sold.set(category, roundToCents(was - (after.get(category) ?? 0)));
  return { result, sold };
}

/** A brokerage sale's basis out leaves the tax buckets and the category it
 *  was sold from, each floored at 0. */
export function takeBasisOut(
  balances: TaxBuckets,
  category: AccountBalance,
  out: number,
): void {
  balances.afterTaxBasis = roundToCents(
    Math.max(0, balances.afterTaxBasis - out),
  );
  setBasis(category, roundToCents(Math.max(0, getBasis(category) - out)));
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
 * Year end: when the accounts hold all brokerage money the aggregate basis is their sum (basis is
 * cost, so it can sit above the balance after a loss). Drift over $1 is surfaced as a diagnostic.
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
    const b = roundToCents(basis.get(k) ?? 0);
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
  balances.afterTaxBasis = total;
  for (const [cat, b] of byCategory) {
    const balance = accountBalance[cat as keyof AccountBalances];
    if (balance.structure === "basis_tracking")
      setBasis(balance, roundToCents(b));
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
