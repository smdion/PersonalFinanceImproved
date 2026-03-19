/**
 * Balance Utilities — cloning, conversion, and dust cleanup.
 *
 * Shared helpers for working with AccountBalances and TaxBuckets.
 * Used by the orchestrator and multiple extraction modules.
 */
import type { TaxBuckets, AccountBalances } from "../types";
import {
  getAllCategories,
  getLimitGroup,
  zeroBalance,
  cloneBalance,
} from "../../config/account-types";
import { roundToCents } from "../../utils/math";

/** Derive AccountBalances from TaxBuckets using a config-derived split (fallback). */
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
    fracByGroup[group] = totalGroups > 0 ? 1 / totalGroups : 0;
  }

  return Object.fromEntries(
    getAllCategories().map((cat) => {
      const bal = zeroBalance(cat);
      const group = getLimitGroup(cat);
      if (bal.structure === "roth_traditional" && group) {
        const frac = fracByGroup[group] ?? 0;
        bal.traditional = roundToCents(b.preTax * frac);
        bal.roth = roundToCents(b.taxFree * frac);
      } else if (bal.structure === "single_bucket") {
        bal.balance = b.hsa;
      } else if (bal.structure === "basis_tracking") {
        bal.balance = b.afterTax;
        bal.basis = b.afterTaxBasis;
      }
      return [cat, bal];
    }),
  ) as AccountBalances;
}

/** Deep-copy AccountBalances. */
export function cloneAccountBalances(a: AccountBalances): AccountBalances {
  return Object.fromEntries(
    getAllCategories().map((cat) => [cat, cloneBalance(a[cat])]),
  ) as AccountBalances;
}
