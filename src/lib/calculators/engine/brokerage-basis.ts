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
 * its balance) when every basis-tracking account has one; otherwise the
 * aggregate basis shared out by starting balance (inputs that predate
 * per-account basis).
 */
export function seedBrokerageBasis(
  indAccts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  aggregateBasis: number,
): BrokerageBasis {
  const accts = basisTrackedAccounts(indAccts);
  const basis: BrokerageBasis = new Map();
  if (accts.length === 0) return basis;
  if (accts.every((ia) => ia.startingBasis != null)) {
    for (const ia of accts)
      basis.set(
        indKey(ia),
        roundToCents(
          Math.max(0, Math.min(ia.startingBasis!, ia.startingBalance)),
        ),
      );
    return basis;
  }
  const total = accts.reduce((s, ia) => s + Math.max(0, ia.startingBalance), 0);
  for (const ia of accts)
    basis.set(
      indKey(ia),
      total > 0
        ? roundToCents(
            aggregateBasis * (Math.max(0, ia.startingBalance) / total),
          )
        : 0,
    );
  return basis;
}

/** Basis ÷ balance over the given accounts (0..1); 0 when they hold nothing. */
export function groupBasisRatio(
  accts: readonly IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  basis: BrokerageBasis,
): number {
  let bal = 0;
  let b = 0;
  for (const ia of basisTrackedAccounts(accts)) {
    const k = indKey(ia);
    bal += Math.max(0, indBal.get(k) ?? 0);
    b += basis.get(k) ?? 0;
  }
  return bal > 0 ? Math.min(1, Math.max(0, b / bal)) : 0;
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
 * Year end: basis never exceeds an account's balance, and the aggregate
 * basis (`balances.afterTaxBasis`, the brokerage `acctBal`) is the sum of
 * the accounts'. A drift over $1 between the year's aggregate bookkeeping
 * and the accounts is surfaced as a diagnostic, like balance drift.
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
