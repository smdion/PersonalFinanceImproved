/**
 * Emergency Fund Calculator (Migration Plan 12.35)
 *
 * Calculates how many months of essential expenses the emergency fund covers.
 * Matches the spreadsheet's "Income Replacement Snapshot" layout:
 *   - Current balance (raw)
 *   - Self-loan amount borrowed from the fund
 *   - Balance "with repay" (what you'd have once loans are repaid)
 *   - Current months covered (raw balance / essential expenses)
 *   - Repaid months (with-repay balance / essential expenses)
 *   - Target amount (targetMonths × essential expenses)
 *   - Needed after repay (target - with-repay balance, negative = ahead)
 *
 * Essential expenses come from the budget calculator (items with isEssential = true).
 * The target months is user-configurable (default 4, matching the spreadsheet).
 */
import type { EFundInput, EFundResult } from "./types";
import { safeDivide } from "../utils/math";

export function calculateEFund(input: EFundInput): EFundResult {
  const warnings: string[] = [];
  const {
    emergencyFundBalance,
    outstandingSelfLoans,
    essentialMonthlyExpenses,
    targetMonths,
  } = input;

  const rawBalance = emergencyFundBalance;
  // True balance = actual balance minus money loaned out from this fund
  const trueBalance = Math.max(0, rawBalance - outstandingSelfLoans);
  // "With repay" = what you'd have once all self-loans are repaid back
  const balanceWithRepay = rawBalance + outstandingSelfLoans;

  if (outstandingSelfLoans > 0) {
    warnings.push(
      `E-fund has $${outstandingSelfLoans.toLocaleString()} in outstanding self-loans`,
    );
  }

  if (essentialMonthlyExpenses === 0) {
    warnings.push(
      "No essential expenses defined — cannot calculate months of coverage",
    );
  }

  // Current months: raw balance / essential expenses (spreadsheet "Current Months")
  const monthsCovered =
    essentialMonthlyExpenses > 0
      ? (safeDivide(rawBalance, essentialMonthlyExpenses) as number)
      : null;

  // Repaid months: with-repay balance / essential expenses (spreadsheet "Repaid Months")
  const monthsCoveredWithRepay =
    essentialMonthlyExpenses > 0
      ? (safeDivide(balanceWithRepay, essentialMonthlyExpenses) as number)
      : null;

  // Target in dollars
  const targetAmount = targetMonths * essentialMonthlyExpenses;

  // How much more is needed after loan repayment (negative = ahead of target)
  const neededAfterRepay = targetAmount - balanceWithRepay;

  // Progress uses "with repay" view (assumes loans will be repaid)
  const progress =
    monthsCoveredWithRepay !== null && targetMonths > 0
      ? Math.min(1, monthsCoveredWithRepay / targetMonths)
      : 0;

  return {
    rawBalance,
    trueBalance,
    outstandingSelfLoans,
    balanceWithRepay,
    monthsCovered,
    monthsCoveredWithRepay,
    targetMonths,
    targetAmount,
    neededAfterRepay,
    progress,
    warnings,
  };
}
