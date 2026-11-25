/**
 * Balance deduction for decumulation: deducts withdrawals from tax buckets and accounts, clamps
 * negatives, tracks depletions, and zeroes rounding dust once the portfolio is depleted.
 */
import type { DecumulationSlot } from "./types/routing";
import type { AccountCategory } from "../../config/account-types";
import type {
  TaxBuckets,
  AccountBalances,
  IndividualAccountInput,
} from "../accounts/account-balances.types";
import type { ProjectionResult } from "./types/projection-result";
import { roundToCents } from "../../utils/math";
import {
  getAllCategories,
  getAccountTypeConfig,
  isOverflowTarget,
  isRetirementMoney,
} from "../../config/account-types";
import {
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
  setTraditional,
  setRoth,
  setBalance,
  setBasis,
  addBalance,
  addBasis,
} from "../accounts/account-balance";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { inflowShares, placeWhole } from "./individual-accounts/part-weights";
import { sliceKey } from "./category-slices";
import type { CategorySide } from "../accounts/category-side";
import {
  categoryBasis,
  followInflowsAdded,
  takeBasisOut,
  type BrokerageBasis,
} from "./brokerage-basis";

// ---------------------------------------------------------------------------
// Withdrawal Deduction
// ---------------------------------------------------------------------------

interface DeductWithdrawalsInput {
  slots: DecumulationSlot[];
  balances: TaxBuckets;
  accountBalance: AccountBalances;
  /** Each brokerage category's basis out for its draw. */
  basisOut: (category: AccountCategory) => number;
}

/**
 * Deduct withdrawals from tax buckets and per-account balances.
 * Mutates `balances` and `accountBalance` in place.
 */
export function deductWithdrawals(input: DeductWithdrawalsInput): void {
  const { slots, balances, accountBalance, basisOut } = input;

  for (const slot of slots) {
    if (
      getAccountTypeConfig(slot.category).balanceStructure === "single_bucket"
    ) {
      balances.hsa = roundToCents(balances.hsa - slot.withdrawal);
      setBalance(
        accountBalance[slot.category],
        roundToCents(
          getTotalBalance(accountBalance[slot.category]) - slot.withdrawal,
        ),
      );
    } else if (isOverflowTarget(slot.category)) {
      balances.afterTax = roundToCents(balances.afterTax - slot.withdrawal);
      setBalance(
        accountBalance[slot.category],
        roundToCents(
          getTotalBalance(accountBalance[slot.category]) - slot.withdrawal,
        ),
      );
      takeBasisOut(
        balances,
        accountBalance[slot.category],
        basisOut(slot.category),
      );
    } else {
      // 401k, 403b, or IRA (roth_traditional)
      balances.preTax = roundToCents(
        balances.preTax - slot.traditionalWithdrawal,
      );
      balances.taxFree = roundToCents(balances.taxFree - slot.rothWithdrawal);
      setTraditional(
        accountBalance[slot.category],
        roundToCents(
          getTraditionalBalance(accountBalance[slot.category]) -
            slot.traditionalWithdrawal,
        ),
      );
      setRoth(
        accountBalance[slot.category],
        roundToCents(
          getRothBalance(accountBalance[slot.category]) - slot.rothWithdrawal,
        ),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Balance Clamping
// ---------------------------------------------------------------------------

/**
 * Ensure no negative balances across all balance systems; an emptied brokerage keeps no basis.
 * Mutates `balances` and `accountBalance` in place; returns each category slice's raise.
 */
export function clampBalances(
  balances: TaxBuckets,
  accountBalance: AccountBalances,
): Map<string, number> {
  balances.preTax = Math.max(0, balances.preTax);
  balances.taxFree = Math.max(0, balances.taxFree);
  balances.hsa = Math.max(0, balances.hsa);
  balances.afterTax = Math.max(0, balances.afterTax);
  if (balances.afterTax === 0) balances.afterTaxBasis = 0;
  const raised = new Map<string, number>();
  for (const cat of getAllCategories()) {
    const balance = accountBalance[cat];
    const floored = (side: CategorySide, value: number) => {
      if (value < 0) raised.set(sliceKey(cat, side), -value);
      return Math.max(0, value);
    };
    if (balance.structure === "roth_traditional") {
      setTraditional(balance, floored("traditional", balance.traditional));
      setRoth(balance, floored("roth", balance.roth));
    } else {
      setBalance(balance, floored("balance", balance.balance));
      if (balance.structure === "basis_tracking" && balance.balance === 0)
        setBasis(balance, 0);
    }
  }
  return raised;
}

// ---------------------------------------------------------------------------
// RMD Excess Reinvestment
// ---------------------------------------------------------------------------

/**
 * Returns the RMD excess over need + tax, at most what the RMD added: only RMD dollars beyond
 * the need. "reinvest" credits it to brokerage as basis (and to Retirement-parented overflow
 * accounts, whose basis follows), mutating `balances`/`accountBalance`; "spend" credits nothing. */
export function reinvestRmdExcess(
  mode: "reinvest" | "spend",
  rmdAdded: number,
  totalWithdrawal: number,
  afterTaxNeed: number,
  taxCost: number,
  balances: TaxBuckets,
  accountBalance: AccountBalances,
  partAccounts?: IndividualAccountInput[],
  partBalance?: Map<string, number>,
  partKey?: IndKeyFn,
  partBasis?: BrokerageBasis,
): number {
  const credit = () =>
    creditRmdExcess(
      mode,
      rmdAdded,
      totalWithdrawal,
      afterTaxNeed,
      taxCost,
      balances,
      accountBalance,
      partAccounts,
      partBalance,
      partKey,
    );
  const { result: excess, added } =
    partAccounts && partBalance && partKey && partBasis
      ? followInflowsAdded(
          partAccounts,
          partKey,
          partBalance,
          partBasis,
          credit,
        )
      : { result: credit(), added: undefined };
  if (mode === "reinvest" && excess > 0) {
    const category = getAllCategories().find(isOverflowTarget);
    const basisIn = category ? categoryBasis(added, excess)(category) : excess;
    balances.afterTaxBasis = roundToCents(balances.afterTaxBasis + basisIn);
    if (category) addBasis(accountBalance[category], basisIn);
  }
  return excess;
}

/** The RMD excess, its money credited (not its basis): to brokerage and to
 *  Retirement-parented overflow accounts in `indBalance`. */
function creditRmdExcess(
  mode: "reinvest" | "spend",
  rmdAdded: number,
  totalWithdrawal: number,
  afterTaxNeed: number,
  taxCost: number,
  balances: TaxBuckets,
  accountBalance: AccountBalances,
  indAccounts?: IndividualAccountInput[],
  indBalance?: Map<string, number>,
  indKey?: IndKeyFn,
): number {
  const overDraw = totalWithdrawal - afterTaxNeed - taxCost;
  const excess = roundToCents(Math.min(rmdAdded, Math.max(0, overDraw)));
  if (excess <= 0) return 0;
  if (mode === "reinvest") {
    balances.afterTax = roundToCents(balances.afterTax + excess);
    for (const cat of getAllCategories()) {
      if (isOverflowTarget(cat)) {
        addBalance(accountBalance[cat], excess);
        if (indAccounts && indBalance && indKey) {
          // The chosen account, else every Retirement brokerage by balance;
          // the opening state always holds one. Never a Portfolio account.
          const retirementAccounts = indAccounts.filter(
            (ia) => ia.category === cat && isRetirementMoney(ia.parentCategory),
          );
          const chosen = retirementAccounts.filter((ia) => ia.rmdExcessTarget);
          const target = chosen.length > 0 ? chosen : retirementAccounts;
          const [first] = target;
          if (!first)
            throw new Error("reinvestRmdExcess: no Retirement brokerage part");
          const balanceOf = (ia: IndividualAccountInput) =>
            Math.max(0, indBalance.get(indKey(ia)) ?? 0);
          // inflowShares decides any group holding money; its fallback, the
          // first part taking it all, is the $0 branch below.
          const targetTotal = target.reduce((s, ia) => s + balanceOf(ia), 0);
          const shares = inflowShares(target.map(balanceOf), () =>
            target.map((_, i) => (i === 0 ? 1 : 0)),
          );
          if (targetTotal > 0) {
            const raw = shares.map((s) => excess * s);
            placeWhole(excess, raw).forEach((share, i) =>
              indBalance.set(
                indKey(target[i]!),
                roundToCents(balanceOf(target[i]!) + share),
              ),
            );
          } else {
            // $0: the fallback above, written on the first part's own
            // balance (a part can sit below $0 until clampIndividualBalances).
            const k = indKey(first);
            indBalance.set(k, roundToCents((indBalance.get(k) ?? 0) + excess));
          }
        }
        break;
      }
    }
  }
  // "spend": intentionally no balance mutation — the money is modeled as
  // consumed, not reinvested. Still returned so the UI can report it.
  return excess;
}

// ---------------------------------------------------------------------------
// Depletion Tracking
// ---------------------------------------------------------------------------

/**
 * Track per-account depletions (first year each sub-bucket hits zero).
 * Mutates `depletionTracked` and `accountDepletions` in place.
 */
export function trackDepletions(
  accountBalance: AccountBalances,
  depletionTracked: Set<string>,
  accountDepletions: ProjectionResult["accountDepletions"],
  year: number,
  age: number,
): void {
  for (const cat of getAllCategories()) {
    const balance = accountBalance[cat];
    const checks: {
      key: string;
      category: AccountCategory;
      subType?: "traditional" | "roth";
      balance: number;
    }[] = [];
    if (balance.structure === "roth_traditional") {
      checks.push({
        key: `${cat}_trad`,
        category: cat,
        subType: "traditional",
        balance: balance.traditional,
      });
      checks.push({
        key: `${cat}_roth`,
        category: cat,
        subType: "roth",
        balance: balance.roth,
      });
    } else if (balance.structure === "single_bucket") {
      checks.push({ key: cat, category: cat, balance: balance.balance });
    } else {
      checks.push({ key: cat, category: cat, balance: balance.balance });
    }
    for (const check of checks) {
      if (check.balance <= 0 && !depletionTracked.has(check.key)) {
        depletionTracked.add(check.key);
        accountDepletions.push({
          category: check.category,
          subType: check.subType,
          depletionYear: year,
          depletionAge: age,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dust Cleanup
// ---------------------------------------------------------------------------

/**
 * Zero out rounding dust when total portfolio is effectively depleted (< $1).
 * Mutates `balances`, `accountBalance`, and `indBalance` in place.
 * Returns true if dust was cleaned.
 */
export function cleanupDust(
  balances: TaxBuckets,
  accountBalance: AccountBalances,
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
): boolean {
  const rawEndBalance =
    balances.preTax + balances.taxFree + balances.hsa + balances.afterTax;
  if (rawEndBalance >= 1) return false;

  balances.preTax = 0;
  balances.taxFree = 0;
  balances.hsa = 0;
  balances.afterTax = 0;
  balances.afterTaxBasis = 0;
  for (const cat of getAllCategories()) {
    const balance = accountBalance[cat];
    if (balance.structure === "roth_traditional") {
      setTraditional(balance, 0);
      setRoth(balance, 0);
    } else if (balance.structure === "basis_tracking") {
      setBalance(balance, 0);
      setBasis(balance, 0);
    } else {
      setBalance(balance, 0);
    }
  }
  for (const ia of indAccounts) indBalance.set(indKey(ia), 0);
  return true;
}
