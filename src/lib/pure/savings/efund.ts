/**
 * Emergency fund: months of essential expenses (budget items with isEssential) covered by the raw,
 * true (less self-loans) and with-repay balances, and the target (targetMonths) and what's
 * needed after repay (negative = ahead).
 */
import type { EFundInput, EFundResult } from "./efund.types";
import { safeDivide } from "../../utils/math";

/** The target, in months, for an emergency fund goal that stores none. */
export const DEFAULT_EFUND_MONTHS = 4;

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
      ? safeDivide(rawBalance, essentialMonthlyExpenses)
      : null;

  // Repaid months: with-repay balance / essential expenses (spreadsheet "Repaid Months")
  const monthsCoveredWithRepay =
    essentialMonthlyExpenses > 0
      ? safeDivide(balanceWithRepay, essentialMonthlyExpenses)
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
