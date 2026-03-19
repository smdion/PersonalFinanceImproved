/**
 * Balance Deduction — withdrawal deduction, clamping, depletion, and dust cleanup.
 *
 * Handles the mechanical balance operations in the decumulation pipeline:
 * deducting withdrawals from tax buckets and per-account balances, ensuring
 * no negative balances, tracking per-account depletions, and zeroing out
 * rounding dust when the portfolio is effectively depleted.
 */
import type {
  DecumulationSlot,
  AccountCategory,
  TaxBuckets,
  AccountBalances,
  IndividualAccountInput,
  ProjectionResult,
} from "../types";
import { roundToCents } from "../../utils/math";
import {
  getAllCategories,
  getAccountTypeConfig,
  isOverflowTarget,
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
} from "../../config/account-types";
import type { IndKeyFn } from "./individual-account-tracking";

// ---------------------------------------------------------------------------
// Withdrawal Deduction
// ---------------------------------------------------------------------------

export interface DeductWithdrawalsInput {
  slots: DecumulationSlot[];
  balances: TaxBuckets;
  acctBal: AccountBalances;
  brokerageBasisPortion: number;
}

/**
 * Deduct withdrawals from tax buckets and per-account balances.
 * Mutates `balances` and `acctBal` in place.
 */
export function deductWithdrawals(input: DeductWithdrawalsInput): void {
  const { slots, balances, acctBal, brokerageBasisPortion } = input;

  for (const slot of slots) {
    if (
      getAccountTypeConfig(slot.category).balanceStructure === "single_bucket"
    ) {
      balances.hsa = roundToCents(balances.hsa - slot.withdrawal);
      setBalance(
        acctBal[slot.category],
        roundToCents(getTotalBalance(acctBal[slot.category]) - slot.withdrawal),
      );
    } else if (isOverflowTarget(slot.category)) {
      balances.afterTax = roundToCents(balances.afterTax - slot.withdrawal);
      balances.afterTaxBasis = roundToCents(
        Math.max(0, balances.afterTaxBasis - brokerageBasisPortion),
      );
      setBalance(
        acctBal[slot.category],
        roundToCents(getTotalBalance(acctBal[slot.category]) - slot.withdrawal),
      );
      setBasis(
        acctBal[slot.category],
        roundToCents(
          Math.max(0, getBasis(acctBal[slot.category]) - brokerageBasisPortion),
        ),
      );
    } else {
      // 401k, 403b, or IRA (roth_traditional)
      balances.preTax = roundToCents(
        balances.preTax - slot.traditionalWithdrawal,
      );
      balances.taxFree = roundToCents(balances.taxFree - slot.rothWithdrawal);
      setTraditional(
        acctBal[slot.category],
        roundToCents(
          getTraditionalBalance(acctBal[slot.category]) -
            slot.traditionalWithdrawal,
        ),
      );
      setRoth(
        acctBal[slot.category],
        roundToCents(
          getRothBalance(acctBal[slot.category]) - slot.rothWithdrawal,
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
 * Mutates `balances` and `acctBal` in place.
 */
export function clampBalances(
  balances: TaxBuckets,
  acctBal: AccountBalances,
): void {
  balances.preTax = Math.max(0, balances.preTax);
  balances.taxFree = Math.max(0, balances.taxFree);
  balances.hsa = Math.max(0, balances.hsa);
  balances.afterTax = Math.max(0, balances.afterTax);
  balances.afterTaxBasis = Math.min(balances.afterTaxBasis, balances.afterTax);
  for (const cat of getAllCategories()) {
    const bal = acctBal[cat];
    if (bal.structure === "roth_traditional") {
      setTraditional(bal, Math.max(0, bal.traditional));
      setRoth(bal, Math.max(0, bal.roth));
    } else if (bal.structure === "single_bucket") {
      setBalance(bal, Math.max(0, bal.balance));
    } else {
      setBalance(bal, Math.max(0, bal.balance));
      setBasis(bal, Math.min(bal.basis, bal.balance));
    }
  }
}

// ---------------------------------------------------------------------------
// RMD Excess Reinvestment
// ---------------------------------------------------------------------------

/**
 * Reinvest RMD excess into brokerage (#39).
 * When RMD forces withdrawal above spending need, excess is after-tax cash
 * reinvested as basis.
 *
 * Mutates `balances` and `acctBal` in place. Returns amount reinvested.
 */
export function reinvestRmdExcess(
  reinvestEnabled: boolean,
  rmdOverrodeRouting: boolean,
  totalWithdrawal: number,
  afterTaxNeed: number,
  taxCost: number,
  balances: TaxBuckets,
  acctBal: AccountBalances,
): number {
  if (
    !reinvestEnabled ||
    !rmdOverrodeRouting ||
    totalWithdrawal <= afterTaxNeed + taxCost
  ) {
    return 0;
  }
  const excess = roundToCents(totalWithdrawal - afterTaxNeed - taxCost);
  balances.afterTax = roundToCents(balances.afterTax + excess);
  balances.afterTaxBasis = roundToCents(balances.afterTaxBasis + excess);
  for (const cat of getAllCategories()) {
    if (isOverflowTarget(cat)) {
      addBalance(acctBal[cat], excess);
      addBasis(acctBal[cat], excess);
      break;
    }
  }
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
  acctBal: AccountBalances,
  depletionTracked: Set<string>,
  accountDepletions: ProjectionResult["accountDepletions"],
  year: number,
  age: number,
): void {
  for (const cat of getAllCategories()) {
    const bal = acctBal[cat];
    const checks: {
      key: string;
      category: AccountCategory;
      subType?: "traditional" | "roth";
      balance: number;
    }[] = [];
    if (bal.structure === "roth_traditional") {
      checks.push({
        key: `${cat}_trad`,
        category: cat,
        subType: "traditional",
        balance: bal.traditional,
      });
      checks.push({
        key: `${cat}_roth`,
        category: cat,
        subType: "roth",
        balance: bal.roth,
      });
    } else if (bal.structure === "single_bucket") {
      checks.push({ key: cat, category: cat, balance: bal.balance });
    } else {
      checks.push({ key: cat, category: cat, balance: bal.balance });
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
 * Mutates `balances`, `acctBal`, and `indBal` in place.
 * Returns true if dust was cleaned.
 */
export function cleanupDust(
  balances: TaxBuckets,
  acctBal: AccountBalances,
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
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
    const bal = acctBal[cat];
    if (bal.structure === "roth_traditional") {
      setTraditional(bal, 0);
      setRoth(bal, 0);
    } else if (bal.structure === "basis_tracking") {
      setBalance(bal, 0);
      setBasis(bal, 0);
    } else {
      setBalance(bal, 0);
    }
  }
  for (const ia of indAccts) indBal.set(indKey(ia), 0);
  return true;
}
