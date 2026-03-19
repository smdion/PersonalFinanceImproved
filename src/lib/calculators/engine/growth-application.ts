/**
 * Growth Application — applies return rate to all balance structures.
 *
 * Used in both accumulation and decumulation phases. Grows market values
 * by the effective return rate while preserving cost basis (brokerage basis
 * does NOT grow — only market value does).
 */
import type { TaxBuckets, AccountBalances } from "../types";
import { roundToCents } from "../../utils/math";
import {
  getAllCategories,
  setTraditional,
  setRoth,
  setBalance,
} from "../../config/account-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GrowthInput {
  /** Effective return rate for this period (may be pro-rated for year 0). */
  effectiveReturn: number;
  /** Aggregate tax bucket balances (mutated in place). */
  balances: TaxBuckets;
  /** Per-account balances (mutated in place). */
  acctBal: AccountBalances;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Apply investment growth to all balance structures.
 *
 * Mutates `balances` and `acctBal` in place. Basis is NOT grown —
 * only market value grows.
 */
export function applyGrowth(input: GrowthInput): void {
  const { effectiveReturn, balances, acctBal } = input;

  // Grow aggregate tax buckets
  balances.preTax = roundToCents(balances.preTax * (1 + effectiveReturn));
  balances.taxFree = roundToCents(balances.taxFree * (1 + effectiveReturn));
  balances.hsa = roundToCents(balances.hsa * (1 + effectiveReturn));
  balances.afterTax = roundToCents(balances.afterTax * (1 + effectiveReturn));
  // Note: afterTaxBasis does NOT grow

  // Grow per-account balances
  for (const cat of getAllCategories()) {
    const bal = acctBal[cat];
    if (bal.structure === "roth_traditional") {
      setTraditional(
        bal,
        roundToCents(bal.traditional * (1 + effectiveReturn)),
      );
      setRoth(bal, roundToCents(bal.roth * (1 + effectiveReturn)));
    } else if (bal.structure === "single_bucket") {
      setBalance(bal, roundToCents(bal.balance * (1 + effectiveReturn)));
    } else {
      // basis_tracking: only market value grows, basis does NOT grow
      setBalance(bal, roundToCents(bal.balance * (1 + effectiveReturn)));
    }
  }
}
