/**
 * Balance Utilities — cloning, conversion, and dust cleanup.
 *
 * Shared helpers for working with AccountBalances and TaxBuckets.
 * Used by the orchestrator and multiple extraction modules.
 */
import type {
  TaxBuckets,
  AccountBalances,
} from "../accounts/account-balances.types";
import type { DecumulationSlot } from "./types/routing";
import {
  getAllCategories,
  getLimitGroup,
  zeroBalance,
} from "../../config/account-types";
import {
  cloneBalance,
  getTotalBalance,
  setTraditional,
  setRoth,
  setBalance,
} from "../accounts/account-balance";
import { roundToCents, safeDivide } from "../../utils/math";
import type {
  EligibilityRecord,
  NonRetirementExclusion,
} from "@/lib/pure/accounts/eligibility";

/**
 * A balance in two scopes: every account (net worth), and retirement money (the aggregate minus
 * Portfolio-parented accounts, clamped at 0). Without individual accounts all of it is retirement.
 */
export function scopedBalances(
  balances: TaxBuckets,
  exclusion: NonRetirementExclusion | undefined,
): { allAccountsBalance: number; retirementBalance: number } {
  const allAccountsBalance = roundToCents(
    balances.preTax + balances.taxFree + balances.hsa + balances.afterTax,
  );
  return {
    allAccountsBalance,
    retirementBalance: Math.max(
      0,
      roundToCents(allAccountsBalance - (exclusion?.grandTotal ?? 0)),
    ),
  };
}

/** Derive AccountBalances from TaxBuckets using a config-derived split.
 *  @public — test fixtures only: the engine input carries
 *  startingAccountBalances, so no src path calls it. */
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

/** Deep-copy AccountBalances. */
export function cloneAccountBalances(a: AccountBalances): AccountBalances {
  return Object.fromEntries(
    getAllCategories().map((cat) => [cat, cloneBalance(a[cat])]),
  ) as AccountBalances;
}

/** @internal Only tests import it (knip --production).
 * Subtracts a record's penalty-exposed dollars per category, floored at 0. Derived by subtraction
 * from `accountBalance`, never by summing `indBalance`. */
export function subtractPenaltyExposed(
  balances: AccountBalances,
  record: EligibilityRecord,
): AccountBalances {
  const result = cloneAccountBalances(balances);
  for (const cat of getAllCategories()) {
    const balance = result[cat];
    if (balance.structure === "roth_traditional") {
      setTraditional(
        balance,
        Math.max(
          0,
          balance.traditional - record.penaltyExposedTradStillExcluded[cat],
        ),
      );
      setRoth(
        balance,
        Math.max(0, balance.roth - record.penaltyExposedRothStillExcluded[cat]),
      );
    } else {
      setBalance(
        balance,
        Math.max(
          0,
          getTotalBalance(balance) -
            record.penaltyExposedTotalStillExcluded[cat],
        ),
      );
    }
  }
  return result;
}

/**
 * Subtracts still-excluded penalty exposure plus Portfolio-parented balances per category, one
 * floor at 0 each. The two never overlap (`computeWithdrawalEligibility` skips Portfolio
 * accounts' exposure). Either may be omitted.
 */
export function subtractExcluded(
  balances: AccountBalances,
  exposure: EligibilityRecord | undefined,
  nonRetirement: NonRetirementExclusion | undefined,
): AccountBalances {
  const result = cloneAccountBalances(balances);
  for (const cat of getAllCategories()) {
    const balance = result[cat];
    if (balance.structure === "roth_traditional") {
      const tradExcl =
        (exposure?.penaltyExposedTradStillExcluded[cat] ?? 0) +
        (nonRetirement?.trad[cat] ?? 0);
      const rothExcl =
        (exposure?.penaltyExposedRothStillExcluded[cat] ?? 0) +
        (nonRetirement?.roth[cat] ?? 0);
      setTraditional(balance, Math.max(0, balance.traditional - tradExcl));
      setRoth(balance, Math.max(0, balance.roth - rothExcl));
    } else {
      const totalExcl =
        (exposure?.penaltyExposedTotalStillExcluded[cat] ?? 0) +
        (nonRetirement?.total[cat] ?? 0);
      setBalance(balance, Math.max(0, getTotalBalance(balance) - totalExcl));
    }
    // Never more than the category's tracked accounts can give: money no
    // tracked account holds is not penalty-free by default
    // (EligibilityRecord.reachableByCategory).
    const reachable = exposure?.reachableByCategory[cat];
    const total = getTotalBalance(balance);
    if (reachable != null && total > reachable) {
      const keep = safeDivide(Math.max(0, reachable), total, 0);
      if (balance.structure === "roth_traditional") {
        setTraditional(balance, roundToCents(balance.traditional * keep));
        setRoth(balance, roundToCents(balance.roth * keep));
      } else setBalance(balance, roundToCents(total * keep));
    }
  }
  return result;
}

/**
 * Replays a RouteResult's slots onto an `AccountBalances` clone (roth/traditional split or total,
 * as the waterfall router branches), floored at 0, so a second dispatch can chain off the first.
 * Categories with no slot stay untouched.
 */
export function applySlotsToBalances(
  balances: AccountBalances,
  slots: DecumulationSlot[],
): AccountBalances {
  const result = cloneAccountBalances(balances);
  const byCategory = new Map(slots.map((s) => [s.category, s]));
  for (const cat of getAllCategories()) {
    const slot = byCategory.get(cat);
    if (!slot || slot.withdrawal === 0) continue;
    const balance = result[cat];
    if (balance.structure === "roth_traditional") {
      setTraditional(
        balance,
        Math.max(0, balance.traditional - slot.traditionalWithdrawal),
      );
      setRoth(balance, Math.max(0, balance.roth - slot.rothWithdrawal));
    } else {
      setBalance(
        balance,
        Math.max(0, getTotalBalance(balance) - slot.withdrawal),
      );
    }
  }
  return result;
}
