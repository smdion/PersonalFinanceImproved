/** Per-category balances from tax buckets, for test fixtures that state
 *  only the buckets. */
import type {
  TaxBuckets,
  AccountBalances,
} from "@/lib/pure/accounts/account-balances.types";
import {
  getAllCategories,
  getLimitGroup,
  zeroBalance,
} from "@/lib/config/account-types";
import { roundToCents, safeDivide } from "@/lib/utils/math";

/** Derive AccountBalances from TaxBuckets using a config-derived split
 *  (test fixtures only; it puts 150% of pre-tax into accounts). */
export function accountBalancesFromTaxBuckets(b: TaxBuckets): AccountBalances {
  // Without real per-account data, split preTax/taxFree proportionally across
  // limit groups that contain roth_traditional categories. Weights are derived
  // from config so adding a new limit group doesn't silently get 0.
  const groupCounts: Record<string, number> = {};
  for (const cat of getAllCategories()) {
    const cfg = {
      structure: zeroBalance(cat).structure,
      group: getLimitGroup(cat),
    };
    if (cfg.structure === "roth_traditional" && cfg.group) {
      groupCounts[cfg.group] = (groupCounts[cfg.group] ?? 0) + 1;
    }
  }
  const totalGroups = Object.keys(groupCounts).length;
  const fracByGroup: Record<string, number> = {};
  for (const group of Object.keys(groupCounts)) {
    fracByGroup[group] = safeDivide(1, totalGroups, 0);
  }

  return Object.fromEntries(
    getAllCategories().map((cat) => {
      const balance = zeroBalance(cat);
      const group = getLimitGroup(cat);
      if (balance.structure === "roth_traditional" && group) {
        const frac = fracByGroup[group] ?? 0;
        balance.traditional = roundToCents(b.preTax * frac);
        balance.roth = roundToCents(b.taxFree * frac);
      } else if (balance.structure === "single_bucket") {
        balance.balance = b.hsa;
      } else if (balance.structure === "basis_tracking") {
        balance.balance = b.afterTax;
        balance.basis = b.afterTaxBasis;
      }
      return [cat, balance];
    }),
  ) as AccountBalances;
}
