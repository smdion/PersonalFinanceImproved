/**
 * Growth Application — applies return rate to all balance structures.
 *
 * Used in both accumulation and decumulation phases. Grows market values
 * by the effective return rate while preserving cost basis (brokerage basis
 * does NOT grow — only market value does).
 */
import type { TaxBuckets, AccountBalances } from "../types";
import { roundToCents } from "../../utils/math";
import { MIN_RETURN_RATE } from "../../constants";
import {
  getAllCategories,
  setTraditional,
  setRoth,
  setBalance,
} from "../../config/account-types";

// ---------------------------------------------------------------------------
// Return rate lookup
// ---------------------------------------------------------------------------

/**
 * Resolve the effective return rate for a given age from a sparse
 * age→rate map (populated only at configured breakpoint ages, e.g. "Age
 * 39") — falls back to the closest configured age at or below the
 * requested one, throws if nothing qualifies, then floors at
 * `MIN_RETURN_RATE`. Extracted from `pre-year-setup.ts` (R47) so the real
 * per-year growth application and any forward-looking projection (e.g.
 * R47's RMD-smoothing lookahead) can't quietly diverge on how a sparse
 * map is resolved — Single Computation Path, `docs/RULES.md`. The
 * `MIN_RETURN_RATE` floor travels WITH the lookup, not as a separate step
 * a caller might forget to apply.
 */
export function resolveReturnRateForAge(
  returnRateMap: Map<number, number>,
  age: number,
): number {
  let rate = returnRateMap.get(age);
  if (rate === undefined) {
    let closestAge = 0;
    returnRateMap.forEach((_rate, rateAge) => {
      if (rateAge <= age) closestAge = rateAge;
    });
    rate = returnRateMap.get(closestAge);
    if (rate === undefined) {
      throw new Error(
        `No return rate configured for age ${age}. Add return rates in retirement settings.`,
      );
    }
  }
  return Math.max(MIN_RETURN_RATE, rate);
}

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
