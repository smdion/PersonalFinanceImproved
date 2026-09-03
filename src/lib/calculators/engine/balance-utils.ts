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
import type {
  EligibilityRecord,
  NonRetirementExclusion,
} from "@/lib/pure/withdrawal-eligibility";

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
 * Subtract a withdrawal-eligibility record's penalty-exposed dollars from
 * balances, per category (supersedes the
 * Tier B two-pass model this function was originally written for; renamed
 * from `subtractLocked`). Floors at 0 —
 * `penaltyExposedTrad`/`penaltyExposedRoth`/`penaltyExposedTotal` are sums
 * of individual-account penalty-exposed amounts, which can't exceed the
 * category total they're within, but flooring keeps this safe against any
 * future drift between `acctBal` and the sum of individual accounts (the
 * same drift `decumulation-year.ts`'s `[DIAG] Roth divergence` check
 * already watches for). Locked design: the penalty-free balance is derived
 * by SUBTRACTION from the real `acctBal`, never by summing `indBal` — see
 * `withdrawal-eligibility.ts`'s module docblock for why the other direction
 * breaks byte-identity.
 */
export function subtractPenaltyExposed(
  balances: AccountBalances,
  record: EligibilityRecord,
): AccountBalances {
  const result = cloneAccountBalances(balances);
  for (const cat of getAllCategories()) {
    const bal = result[cat];
    if (bal.structure === "roth_traditional") {
      setTraditional(
        bal,
        Math.max(
          0,
          bal.traditional - (record.penaltyExposedTradStillExcluded[cat] ?? 0),
        ),
      );
      setRoth(
        bal,
        Math.max(
          0,
          bal.roth - (record.penaltyExposedRothStillExcluded[cat] ?? 0),
        ),
      );
    } else {
      setBalance(
        bal,
        Math.max(
          0,
          getTotalBalance(bal) -
            (record.penaltyExposedTotalStillExcluded[cat] ?? 0),
        ),
      );
    }
  }
  return result;
}

/**
 * Subtract BOTH still-excluded penalty exposure and Portfolio-parented
 * ("non-retirement") balances from `balances`, per category. Sums
 * the two sources before a single floor-at-0 per bucket — mathematically
 * equivalent to two sequential `subtractPenaltyExposed`-style clamps
 * (`max(0, max(0, x-a)-b) === max(0, x-a-b)` for non-negative `a`/`b`), so
 * this isn't about floor-order correctness; it's simply the natural shape
 * once there are two sources instead of one. The property that actually
 * matters — and the reason the two sources are safe to add together at
 * all — is that they're guaranteed not to double-count the same dollar:
 * `computeWithdrawalEligibility` never adds a Portfolio-parented account's
 * exposure to its `*StillExcluded` aggregates (see that function's
 * `isRetirementParent` gate), so `exposure`'s totals and `nonRetirement`'s
 * totals never overlap. Either argument may be omitted/all-zero; degrades
 * to `subtractPenaltyExposed`'s exact behavior, or a no-op clone,
 * accordingly.
 */
export function subtractExcluded(
  balances: AccountBalances,
  exposure: EligibilityRecord | undefined,
  nonRetirement: NonRetirementExclusion | undefined,
): AccountBalances {
  const result = cloneAccountBalances(balances);
  for (const cat of getAllCategories()) {
    const bal = result[cat];
    if (bal.structure === "roth_traditional") {
      const tradExcl =
        (exposure?.penaltyExposedTradStillExcluded[cat] ?? 0) +
        (nonRetirement?.trad[cat] ?? 0);
      const rothExcl =
        (exposure?.penaltyExposedRothStillExcluded[cat] ?? 0) +
        (nonRetirement?.roth[cat] ?? 0);
      setTraditional(bal, Math.max(0, bal.traditional - tradExcl));
      setRoth(bal, Math.max(0, bal.roth - rothExcl));
    } else {
      const totalExcl =
        (exposure?.penaltyExposedTotalStillExcluded[cat] ?? 0) +
        (nonRetirement?.total[cat] ?? 0);
      setBalance(bal, Math.max(0, getTotalBalance(bal) - totalExcl));
    }
  }
  return result;
}

/**
 * Replay a `RouteResult`'s drawn slots back onto an `AccountBalances`
 * clone — reduces each category by what was actually withdrawn, mirroring
 * `routeWithdrawals`'s own per-category branching (roth/traditional split
 * for `roth_traditional` categories, total withdrawal for everything else:
 * `single_bucket` HSA and `basis_tracking`/overflow brokerage both reduce
 * by total dollars the same way `subtractExcluded`'s own `else` branch
 * already does). Floors at 0 for the same drift-safety reason
 * `subtractPenaltyExposed` floors — a slot's withdrawal can't exceed the
 * balance it was drawn from BY CONSTRUCTION (`routeWithdrawals` clamps to
 * available balance), but flooring costs nothing and guards against any
 * future divergence.
 *
 * The one piece of new balance-mutation arithmetic
 * `routeWithLastResortAllowance`'s two-dispatch merge needs and that didn't
 * exist anywhere in the engine before — `dispatchOnce`/`routeWithdrawals`
 * never mutate the `AccountBalances` they're given, they only compute
 * slots; the real balance reduction has always happened elsewhere
 * (decumulation-year.ts's own post-routing bookkeeping), which is fine for
 * a single dispatch per year but not for chaining a second dispatch against
 * "what's left after the first one drew."
 *
 * Categories with no slot entry are left untouched (not zeroed) — a slot
 * array need not cover every category (e.g. a category the withdrawal
 * order skipped, or a partial/filtered slots array from a caller that only
 * cares about specific categories).
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
    const bal = result[cat];
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
