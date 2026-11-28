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
import type { IndividualAccountInput } from "../accounts/account-balances.types";
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

/** `followDraws` on copies of `balances` and `basis`; `land` then writes the
 *  copies into the same maps. */
export function followDrawsOnCopies<T>(
  accounts: readonly IndividualAccountInput[],
  keyOf: IndKeyFn,
  balances: Map<string, number>,
  basis: BrokerageBasis,
  mutate: (drawn: Map<string, number>) => T,
): { result: T; land: () => void } {
  const drawn = new Map(balances);
  const drawnBasis = new Map(basis);
  const result = followDraws(accounts, keyOf, drawn, drawnBasis, () =>
    mutate(drawn),
  );
  const land = () => {
    for (const [k, v] of drawn) balances.set(k, v);
    for (const [k, v] of drawnBasis) basis.set(k, v);
  };
  return { result, land };
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
