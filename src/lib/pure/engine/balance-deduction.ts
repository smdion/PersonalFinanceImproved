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
  getBasis,
  setTraditional,
  setRoth,
  setBalance,
  setBasis,
  addBalance,
  addBasis,
} from "../../config/account-balance";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";

// ---------------------------------------------------------------------------
// Withdrawal Deduction
// ---------------------------------------------------------------------------

interface DeductWithdrawalsInput {
  slots: DecumulationSlot[];
  balances: TaxBuckets;
  accountBalance: AccountBalances;
  brokerageBasisPortion: number;
}

/**
 * Deduct withdrawals from tax buckets and per-account balances.
 * Mutates `balances` and `accountBalance` in place.
 */
export function deductWithdrawals(input: DeductWithdrawalsInput): void {
  const { slots, balances, accountBalance, brokerageBasisPortion } = input;

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
      balances.afterTaxBasis = roundToCents(
        Math.max(0, balances.afterTaxBasis - brokerageBasisPortion),
      );
      setBalance(
        accountBalance[slot.category],
        roundToCents(
          getTotalBalance(accountBalance[slot.category]) - slot.withdrawal,
        ),
      );
      setBasis(
        accountBalance[slot.category],
        roundToCents(
          Math.max(
            0,
            getBasis(accountBalance[slot.category]) - brokerageBasisPortion,
          ),
        ),
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
 * Ensure no negative balances across all balance systems.
 * Mutates `balances` and `accountBalance` in place.
 */
export function clampBalances(
  balances: TaxBuckets,
  accountBalance: AccountBalances,
): void {
  balances.preTax = Math.max(0, balances.preTax);
  balances.taxFree = Math.max(0, balances.taxFree);
  balances.hsa = Math.max(0, balances.hsa);
  balances.afterTax = Math.max(0, balances.afterTax);
  balances.afterTaxBasis = Math.min(balances.afterTaxBasis, balances.afterTax);
  for (const cat of getAllCategories()) {
    const balance = accountBalance[cat];
    if (balance.structure === "roth_traditional") {
      setTraditional(balance, Math.max(0, balance.traditional));
      setRoth(balance, Math.max(0, balance.roth));
    } else if (balance.structure === "single_bucket") {
      setBalance(balance, Math.max(0, balance.balance));
    } else {
      setBalance(balance, Math.max(0, balance.balance));
      setBasis(balance, Math.min(balance.basis, balance.balance));
    }
  }
}

// ---------------------------------------------------------------------------
// RMD Excess Reinvestment
// ---------------------------------------------------------------------------

/**
 * Returns the RMD excess over spending need + tax. "reinvest" credits it to brokerage as basis
 * (and to Retirement-parented overflow accounts in `indBalance`); "spend" credits nothing.
 * Mutates `balances`/`accountBalance` only under "reinvest".
 */
export function reinvestRmdExcess(
  mode: "reinvest" | "spend",
  rmdOverrodeRouting: boolean,
  totalWithdrawal: number,
  afterTaxNeed: number,
  taxCost: number,
  balances: TaxBuckets,
  accountBalance: AccountBalances,
  indAccounts?: IndividualAccountInput[],
  indBalance?: Map<string, number>,
  indKey?: IndKeyFn,
): number {
  if (!rmdOverrodeRouting || totalWithdrawal <= afterTaxNeed + taxCost) {
    return 0;
  }
  const excess = roundToCents(totalWithdrawal - afterTaxNeed - taxCost);
  if (mode === "reinvest") {
    balances.afterTax = roundToCents(balances.afterTax + excess);
    balances.afterTaxBasis = roundToCents(balances.afterTaxBasis + excess);
    for (const cat of getAllCategories()) {
      if (isOverflowTarget(cat)) {
        addBalance(accountBalance[cat], excess);
        addBasis(accountBalance[cat], excess);
        if (indAccounts && indBalance && indKey) {
          // The chosen account, else every Retirement brokerage by balance.
          // Never a Portfolio account: with none it stays in the aggregate.
          const retirementAccounts = indAccounts.filter(
            (ia) => ia.category === cat && isRetirementMoney(ia.parentCategory),
          );
          const chosen = retirementAccounts.filter((ia) => ia.rmdExcessTarget);
          const target = chosen.length > 0 ? chosen : retirementAccounts;
          const targetTotal = target.reduce(
            (s, ia) => s + Math.max(0, indBalance.get(indKey(ia)) ?? 0),
            0,
          );
          if (target.length > 0) {
            if (targetTotal > 0) {
              let credited = 0;
              for (const ia of target) {
                const k = indKey(ia);
                const balance = Math.max(0, indBalance.get(k) ?? 0);
                const share = roundToCents(excess * (balance / targetTotal));
                indBalance.set(k, roundToCents(balance + share));
                credited += share;
              }
              const remainder = roundToCents(excess - credited);
              if (remainder !== 0) {
                const first = target[0]!;
                const k = indKey(first);
                indBalance.set(
                  k,
                  roundToCents((indBalance.get(k) ?? 0) + remainder),
                );
              }
            } else {
              // No weight to distribute by (every target account is at
              // $0) -- credit the first one entirely rather than inventing
              // a different allocation policy.
              const k = indKey(target[0]!);
              indBalance.set(
                k,
                roundToCents((indBalance.get(k) ?? 0) + excess),
              );
            }
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
