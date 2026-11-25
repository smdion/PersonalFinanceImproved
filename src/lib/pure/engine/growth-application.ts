/**
 * Applies the return rate to every balance structure in both phases. Market value grows; cost
 * basis does not.
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
} from "../accounts/account-balance";
import { sliceKey } from "./category-slices";
import type { CategorySide } from "../accounts/category-side";

// ---------------------------------------------------------------------------
// Return rate lookup
// ---------------------------------------------------------------------------

/**
 * Return rate for an age from a sparse breakpoint map: the breakpoint at or below `age`, throws
 * if none, floored at `MIN_RETURN_RATE`. Shared by growth and lookaheads (RMD smoothing).
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
  /** Each category slice's account parts' growth (and floor raises), summed
   *  (`sumBySlice`); empty on a run that holds no accounts. */
  partsBySlice: ReadonlyMap<string, number>;
}

/** A category slice's balance after growth: plus its parts' summed growth
 *  when it has parts, otherwise its own rounded product. */
function grownSlice(
  balance: number,
  effectiveReturn: number,
  fromParts: number | undefined,
): number {
  return roundToCents(
    fromParts === undefined
      ? balance * (1 + effectiveReturn)
      : balance + fromParts,
  );
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
  const { effectiveReturn, balances, accountBalance, partsBySlice } = input;

  // Grow aggregate tax buckets
  balances.preTax = roundToCents(balances.preTax * (1 + effectiveReturn));
  balances.taxFree = roundToCents(balances.taxFree * (1 + effectiveReturn));
  balances.hsa = roundToCents(balances.hsa * (1 + effectiveReturn));
  balances.afterTax = roundToCents(balances.afterTax * (1 + effectiveReturn));
  // Note: afterTaxBasis does NOT grow

  // Grow each category slice; basis does NOT grow
  for (const cat of getAllCategories()) {
    const balance = accountBalance[cat];
    const grown = (side: CategorySide, value: number) =>
      grownSlice(value, effectiveReturn, partsBySlice.get(sliceKey(cat, side)));
    if (balance.structure === "roth_traditional") {
      setTraditional(balance, grown("traditional", balance.traditional));
      setRoth(balance, grown("roth", balance.roth));
    } else setBalance(balance, grown("balance", balance.balance));
  }
}
