/**
 * Growth Application — applies return rate to all balance structures.
 *
 * Used in both accumulation and decumulation phases. Grows market values
 * by the effective return rate while preserving cost basis (brokerage basis
 * does NOT grow — only market value does).
 */
import type {
  TaxBuckets,
  AccountBalances,
} from "../accounts/account-balances.types";
import { roundToCents } from "../../utils/math";
import { MIN_RETURN_RATE } from "../../constants";
import { returnRateAtAge } from "@/lib/pure/simulation/return-rate-breakpoints";
import { getAllCategories } from "../../config/account-types";
import {
  setTraditional,
  setRoth,
  setBalance,
} from "../../config/account-balance";

// ---------------------------------------------------------------------------
// Return rate lookup
// ---------------------------------------------------------------------------

/**
 * Resolve the effective return rate for a given age from a sparse
 * age→rate map (populated only at configured breakpoint ages, e.g. "Age
 * 39") — the breakpoint at or below the requested age
 * (returnRateAtAge), throws if nothing qualifies, then floors at
 * `MIN_RETURN_RATE`. Shared so the real
 * per-year growth application and any forward-looking projection (e.g. the
 * RMD-smoothing lookahead) can't quietly diverge on how a sparse
 * map is resolved — Single Computation Path, `docs/RULES.md`. The
 * `MIN_RETURN_RATE` floor travels WITH the lookup, not as a separate step
 * a caller might forget to apply.
 */
export function resolveReturnRateForAge(
  returnRateMap: Map<number, number>,
  age: number,
): number {
  const rate = returnRateAtAge(returnRateMap, age);
  if (rate === null) {
    throw new Error(
      `No return rate configured for age ${age}. Add return rates in retirement settings.`,
    );
  }
  return Math.max(MIN_RETURN_RATE, rate);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GrowthInput {
  /** Effective return rate for this period (may be pro-rated for year 0). */
  effectiveReturn: number;
  /** Aggregate tax bucket balances (mutated in place). */
  balances: TaxBuckets;
  /** Per-account balances (mutated in place). */
  accountBalance: AccountBalances;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Apply investment growth to all balance structures.
 *
 * Mutates `balances` and `accountBalance` in place. Basis is NOT grown —
 * only market value grows.
 */
export function applyGrowth(input: GrowthInput): void {
  const { effectiveReturn, balances, accountBalance } = input;

  // Grow aggregate tax buckets
  balances.preTax = roundToCents(balances.preTax * (1 + effectiveReturn));
  balances.taxFree = roundToCents(balances.taxFree * (1 + effectiveReturn));
  balances.hsa = roundToCents(balances.hsa * (1 + effectiveReturn));
  balances.afterTax = roundToCents(balances.afterTax * (1 + effectiveReturn));
  // Note: afterTaxBasis does NOT grow

  // Grow per-account balances
  for (const cat of getAllCategories()) {
    const balance = accountBalance[cat];
    if (balance.structure === "roth_traditional") {
      setTraditional(
        balance,
        roundToCents(balance.traditional * (1 + effectiveReturn)),
      );
      setRoth(balance, roundToCents(balance.roth * (1 + effectiveReturn)));
    } else if (balance.structure === "single_bucket") {
      setBalance(
        balance,
        roundToCents(balance.balance * (1 + effectiveReturn)),
      );
    } else {
      // basis_tracking: only market value grows, basis does NOT grow
      setBalance(
        balance,
        roundToCents(balance.balance * (1 + effectiveReturn)),
      );
    }
  }
}
