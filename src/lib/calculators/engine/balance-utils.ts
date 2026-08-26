/**
 * Balance Utilities — cloning, conversion, and dust cleanup.
 *
 * Shared helpers for working with AccountBalances and TaxBuckets.
 * Used by the orchestrator and multiple extraction modules.
 */
import type { TaxBuckets, AccountBalances, DecumulationSlot } from "../types";
import {
  getAllCategories,
  getLimitGroup,
  zeroBalance,
  cloneBalance,
  getTotalBalance,
  setTraditional,
  setRoth,
  setBalance,
} from "../../config/account-types";
import { roundToCents } from "../../utils/math";
import type { EligibilityRecord } from "@/lib/pure/withdrawal-eligibility";

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

/**
 * Subtract a withdrawal-eligibility record's locked dollars from balances,
 * per category (v0.7.8, PLAN-v0.7.8-v4 Group 2.2, Tier B). Floors at 0 —
 * `lockedTrad`/`lockedRoth`/`lockedTotal` are sums of individual-account
 * lock amounts, which can't exceed the category total they're locked
 * within, but flooring keeps this safe against any future drift between
 * `acctBal` and the sum of individual accounts (the same drift
 * `decumulation-year.ts`'s `[DIAG] Roth divergence` check already watches
 * for). Locked design: `eligibleBalances` is derived by SUBTRACTION from
 * the real `acctBal`, never by summing `indBal` — see
 * `withdrawal-eligibility.ts`'s module docblock (Q3 part 2) for why the
 * other direction breaks byte-identity.
 */
export function subtractLocked(
  balances: AccountBalances,
  record: EligibilityRecord,
): AccountBalances {
  const result = cloneAccountBalances(balances);
  for (const cat of getAllCategories()) {
    const bal = result[cat];
    if (bal.structure === "roth_traditional") {
      setTraditional(
        bal,
        Math.max(0, bal.traditional - (record.lockedTrad[cat] ?? 0)),
      );
      setRoth(bal, Math.max(0, bal.roth - (record.lockedRoth[cat] ?? 0)));
    } else {
      setBalance(
        bal,
        Math.max(0, getTotalBalance(bal) - (record.lockedTotal[cat] ?? 0)),
      );
    }
  }
  return result;
}

/**
 * Subtract already-drawn slot amounts from balances, per category (Tier B
 * pass 2's "remaining balances" — full balances minus pass 1's draws).
 * Floors at 0 for the same drift-safety reason as `subtractLocked`.
 */
export function subtractSlots(
  balances: AccountBalances,
  slots: DecumulationSlot[],
): AccountBalances {
  const result = cloneAccountBalances(balances);
  for (const slot of slots) {
    const bal = result[slot.category];
    if (bal.structure === "roth_traditional") {
      setTraditional(
        bal,
        Math.max(0, bal.traditional - slot.traditionalWithdrawal),
      );
      setRoth(bal, Math.max(0, bal.roth - slot.rothWithdrawal));
    } else {
      setBalance(bal, Math.max(0, getTotalBalance(bal) - slot.withdrawal));
    }
  }
  return result;
}
