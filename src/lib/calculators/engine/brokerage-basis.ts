/**
 * Brokerage cost basis per individual account.
 *
 * The aggregate `afterTaxBasis` can't tell a Retirement brokerage's basis
 * from a Portfolio one's, so a single ratio priced every brokerage
 * withdrawal's capital gains — wrong whenever the two differ (and they do:
 * a long-held Portfolio brokerage vs a newer Retirement one). Basis is kept
 * here per basis-tracking account, like the Roth basis in `indBasis`; the
 * ratio a withdrawal uses is the sum over the accounts it draws from
 * (`groupBasisRatio`), and the aggregate is the sum of the accounts
 * (`syncAggregateBasis`).
 *
 * Every per-account balance change follows one of two rules:
 * - money in (contributions, match, overflow, ramp, lump sums, reinvested
 *   RMD money): `followInflows` adds the increase as basis;
 * - money out (withdrawals, goal draws, reconciliation, clamps, dust):
 *   `followDraws` takes basis out at that account's own ratio.
 * Growth changes balances only, never basis.
 */
import { roundToCents } from "../../utils/math";
import {
  getAccountTypeConfig,
  isPortfolioParent,
  setBasis,
} from "../../config/account-types";
import type {
  AccountBalances,
  IndividualAccountInput,
  TaxBuckets,
} from "../types";
import type { IndKeyFn } from "./individual-account-tracking";

export type BrokerageBasis = Map<string, number>;

/** Accounts whose balance structure tracks cost basis (brokerage). */
export function basisTrackedAccounts(
  indAccts: readonly IndividualAccountInput[],
): IndividualAccountInput[] {
  return indAccts.filter(
    (ia) =>
      getAccountTypeConfig(ia.category).balanceStructure === "basis_tracking",
  );
}

/**
 * Starting basis per account: each account's own `startingBasis` (capped at
 * its balance); accounts without one share what's left of the aggregate
 * basis (aggregate − the known ones) by starting balance — inputs that
 * predate per-account basis, or an account whose basis was never entered.
 */
export function seedBrokerageBasis(
  indAccts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  aggregateBasis: number,
): BrokerageBasis {
  const accts = basisTrackedAccounts(indAccts);
  const basis: BrokerageBasis = new Map();
  let known = 0;
  for (const ia of accts) {
    if (ia.startingBasis == null) continue;
    const b = roundToCents(
      Math.max(0, Math.min(ia.startingBasis, Math.max(0, ia.startingBalance))),
    );
    basis.set(indKey(ia), b);
    known += b;
  }
  const missing = accts.filter((ia) => ia.startingBasis == null);
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
  accts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  basis: BrokerageBasis,
): number | undefined {
  let bal = 0;
  let b = 0;
  for (const ia of basisTrackedAccounts(accts)) {
    const k = indKey(ia);
    bal += Math.max(0, indBal.get(k) ?? 0);
    b += basis.get(k) ?? 0;
  }
  return bal > 0 ? Math.min(1, Math.max(0, b / bal)) : undefined;
}

function brokerageBalances(
  indAccts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
): Map<string, number> {
  return new Map(
    basisTrackedAccounts(indAccts).map((ia) => [
      indKey(ia),
      Math.max(0, indBal.get(indKey(ia)) ?? 0),
    ]),
  );
}

/** Run `mutate` (money out); any brokerage account whose balance fell
 *  gives up basis at its own ratio before the change. */
export function followDraws<T>(
  indAccts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  basis: BrokerageBasis,
  mutate: () => T,
): T {
  const before = brokerageBalances(indAccts, indKey, indBal);
  const result = mutate();
  for (const [k, was] of before) {
    const now = Math.max(0, indBal.get(k) ?? 0);
    if (now >= was || was <= 0) continue;
    const b = basis.get(k) ?? 0;
    basis.set(k, roundToCents(Math.max(0, b - (was - now) * (b / was))));
  }
  return result;
}

/** Run `mutate` (money in); every brokerage account's increase is new
 *  basis (cash contributed or reinvested). */
export function followInflows<T>(
  indAccts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  basis: BrokerageBasis,
  mutate: () => T,
): T {
  const before = brokerageBalances(indAccts, indKey, indBal);
  const result = mutate();
  for (const [k, was] of before) {
    const now = Math.max(0, indBal.get(k) ?? 0);
    if (now > was) basis.set(k, roundToCents((basis.get(k) ?? 0) + now - was));
  }
  return result;
}

/**
 * Run the yearly reconciliation (`mutate`). Accounts it lowers give up basis
 * at their own ratio (`followDraws`). Accounts it raises are holding cash the
 * aggregate already tracked with its basis (contributions with no
 * per-account route, lump sums with no matching account, …): they receive
 * the aggregate's basis surplus over the accounts, by their increase and at
 * most the increase.
 */
export function followReconciliation<T>(
  indAccts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  basis: BrokerageBasis,
  aggregateBasis: number,
  mutate: () => T,
): T {
  const before = brokerageBalances(indAccts, indKey, indBal);
  const result = followDraws(indAccts, indKey, indBal, basis, mutate);
  const raised = [...before]
    .map(([k, was]) => [k, Math.max(0, indBal.get(k) ?? 0) - was] as const)
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
 * Year end: basis never exceeds an account's balance, and the aggregate
 * basis (`balances.afterTaxBasis`, the brokerage `acctBal`) is the sum of
 * the accounts' — when the accounts hold all the brokerage money. A drift
 * over $1 between the year's aggregate bookkeeping and the accounts is
 * surfaced as a diagnostic, like balance drift.
 */
export function syncAggregateBasis(
  indAccts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  basis: BrokerageBasis,
  balances: TaxBuckets,
  acctBal: AccountBalances,
  diagnostics: string[],
): void {
  const accts = basisTrackedAccounts(indAccts);
  if (accts.length === 0) return;
  // The accounts' sum is the truth only when they hold all the brokerage
  // money; when some lives only in the aggregate (reconciliation had no
  // account to put it in — e.g. overflow with only a projection-only
  // account at $0), keep the aggregate's basis and say so.
  const held = accts.reduce(
    (s, ia) => s + Math.max(0, indBal.get(indKey(ia)) ?? 0),
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
  for (const ia of accts) {
    const k = indKey(ia);
    const b = roundToCents(
      Math.min(basis.get(k) ?? 0, Math.max(0, indBal.get(k) ?? 0)),
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
    const bal = acctBal[cat as keyof AccountBalances];
    if (bal.structure === "basis_tracking")
      setBasis(bal, roundToCents(Math.min(b, bal.balance)));
  }
}

/** The ratio a retirement withdrawal from brokerage uses: the
 *  Retirement-parented brokerages' own basis ÷ balance (retirement never
 *  draws Portfolio ones). Undefined when there is no Retirement brokerage
 *  account (brokerage money then lives only in the aggregate, e.g. built
 *  from overflow) — callers fall back to the aggregate ratio. */
export function retirementBrokerageBasisRatio(
  indAccts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  basis: BrokerageBasis,
): number | undefined {
  const accts = basisTrackedAccounts(indAccts).filter(
    (ia) => !isPortfolioParent(ia.parentCategory),
  );
  return accts.length > 0
    ? groupBasisRatio(accts, indKey, indBal, basis)
    : undefined;
}
