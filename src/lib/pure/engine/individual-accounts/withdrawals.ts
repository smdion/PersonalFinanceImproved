/** Draws spread to the individual accounts: brokerage goals' draws and a
 *  retirement year's slot-level withdrawals. */
import type { DecumulationSlot } from "../types/routing";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import { roundToCents } from "../../../utils/math";
import {
  getAccountTypeConfig,
  isOverflowTarget,
  isPreTaxType,
  isTaxFreeBucket,
  isRetirementMoney,
} from "../../../config/account-types";
import type { EligibilityRecord } from "@/lib/pure/accounts/eligibility";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";

/**
 * The accounts brokerage goals draw from: Portfolio-parented brokerages.
 * Goals are Portfolio money (the Brokerage page's goals); retirement
 * brokerages fund retirement and are never drawn for them.
 */
export function goalFundingAccounts(
  indAccounts: IndividualAccountInput[],
): IndividualAccountInput[] {
  return indAccounts.filter(
    (ia) =>
      isOverflowTarget(ia.category) && !isRetirementMoney(ia.parentCategory),
  );
}

/** What the goal-funding accounts hold now (the most a goal can draw). */
export function goalFundingBalance(
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
): number {
  return roundToCents(
    goalFundingAccounts(indAccounts).reduce(
      (s, ia) => s + Math.max(0, indBalance.get(indKey(ia)) ?? 0),
      0,
    ),
  );
}

/**
 * Distribute a brokerage goal withdrawal across the goal-funding
 * (Portfolio-parented) brokerages, by balance. Mutates `indBalance` in place.
 */
export function distributeGoalWithdrawal(
  drawAmount: number,
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
): void {
  const brokAccounts = goalFundingAccounts(indAccounts);
  const brokTotal = brokAccounts.reduce(
    (s, ia) => s + Math.max(0, indBalance.get(indKey(ia)) ?? 0),
    0,
  );
  for (const ia of brokAccounts) {
    const k = indKey(ia);
    const weight =
      brokTotal > 0
        ? Math.max(0, indBalance.get(k) ?? 0) / brokTotal
        : 1 / brokAccounts.length;
    indBalance.set(
      k,
      roundToCents((indBalance.get(k) ?? 0) - drawAmount * weight),
    );
  }
}

/**
 * Spreads each slot's withdrawal over its category/tax-slice accounts by balance, preferring
 * penalty-free dollars first (only which account pays, never slot totals). Mutates `indBalance`;
 * returns per-account amounts and shortfall warnings when the per-account track runs out.
 */
export function distributeWithdrawals(
  slots: DecumulationSlot[],
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  eligibility?: EligibilityRecord,
  /** Traditional draws an owner's RMD fixes to an account (rmd-enforcement.ts
   *  `enforceOwnerRmds`): applied first; the rest of the slot fans out as usual. */
  pins?: ReadonlyMap<string, number>,
): { decumulationIndWithdrawal: Map<string, number>; warnings: string[] } {
  const decumulationIndWithdrawal = new Map<string, number>();
  const warnings: string[] = [];
  const reportShortfall = (shortfall: number, label: string) => {
    if (shortfall <= 0.005) return;
    warnings.push(
      `Individual-account shortfall: $${shortfall.toFixed(2)} of ${label} withdrawal could not be allocated to any tracked account`,
    );
  };

  for (const slot of slots) {
    if (slot.withdrawal <= 0) continue;
    // Portfolio-parented accounts are never a withdrawal target: a hard
    // guarantee behind the category-level exclusion upstream (subtractExcluded).
    const catAccounts = indAccounts.filter(
      (ia) =>
        ia.category === slot.category && isRetirementMoney(ia.parentCategory),
    );
    const bs = getAccountTypeConfig(slot.category).balanceStructure;

    if (
      bs === "roth_traditional" &&
      (slot.traditionalWithdrawal > 0 || slot.rothWithdrawal > 0)
    ) {
      const tradAccounts = catAccounts.filter((ia) => isPreTaxType(ia.taxType));
      const rothAccounts = catAccounts.filter((ia) =>
        isTaxFreeBucket(ia.taxType),
      );

      // Distribute traditional withdrawal to preTax accounts (#33/#35)
      if (slot.traditionalWithdrawal > 0 && tradAccounts.length > 0) {
        let pinned = 0;
        for (const ia of tradAccounts) {
          const k = indKey(ia);
          const pin = pins?.get(k) ?? 0;
          if (pin <= 0) continue;
          indBalance.set(k, roundToCents((indBalance.get(k) ?? 0) - pin));
          decumulationIndWithdrawal.set(
            k,
            (decumulationIndWithdrawal.get(k) ?? 0) + pin,
          );
          pinned = roundToCents(pinned + pin);
        }
        reportShortfall(
          distributeProportionallyPreferringPenaltyFree(
            roundToCents(slot.traditionalWithdrawal - pinned),
            tradAccounts,
            indKey,
            indBalance,
            decumulationIndWithdrawal,
            eligibility,
          ),
          `${slot.category} traditional`,
        );
      }
      // Distribute roth withdrawal to taxFree accounts (#33/#35)
      if (slot.rothWithdrawal > 0 && rothAccounts.length > 0) {
        reportShortfall(
          distributeProportionallyPreferringPenaltyFree(
            slot.rothWithdrawal,
            rothAccounts,
            indKey,
            indBalance,
            decumulationIndWithdrawal,
            eligibility,
          ),
          `${slot.category} Roth`,
        );
      }
    } else {
      // Single-bucket / brokerage / fallback (#33/#35)
      if (catAccounts.length > 0) {
        reportShortfall(
          distributeProportionallyPreferringPenaltyFree(
            slot.withdrawal,
            catAccounts,
            indKey,
            indBalance,
            decumulationIndWithdrawal,
            eligibility,
          ),
          slot.category,
        );
      }
    }
  }

  return { decumulationIndWithdrawal, warnings };
}

/**
 * Two-pass split: penalty-free dollars first (each account's `penaltyFreeAmount` as a ceiling, so
 * partly penalty-free Roth IRAs count), then penalty-exposed. Falls through to one plain
 * `distributeProportionally` call when nothing in the list is penalty-exposed.
 */
function distributeProportionallyPreferringPenaltyFree(
  amount: number,
  accounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  withdrawalMap: Map<string, number>,
  exposure: EligibilityRecord | undefined,
): number {
  if (!exposure || exposure.totalPenaltyExposed === 0) {
    return distributeProportionally(
      amount,
      accounts,
      indKey,
      indBalance,
      withdrawalMap,
    );
  }
  const hasExposureInList = accounts.some(
    (ia) => (exposure.byKey.get(indKey(ia))?.penaltyExposedAmount ?? 0) > 0,
  );
  if (!hasExposureInList) {
    return distributeProportionally(
      amount,
      accounts,
      indKey,
      indBalance,
      withdrawalMap,
    );
  }
  // First pass: draw only against each account's own penalty-free capacity
  // (never more than its current balance).
  const penaltyFreeCapacity = new Map<string, number>(
    accounts.map((ia) => {
      const k = indKey(ia);
      const balance = Math.max(0, indBalance.get(k) ?? 0);
      const accountExposure = exposure.byKey.get(k);
      return [
        k,
        accountExposure
          ? Math.min(balance, accountExposure.penaltyFreeAmount)
          : balance,
      ];
    }),
  );
  const shortfall = distributeProportionally(
    amount,
    accounts,
    indKey,
    indBalance,
    withdrawalMap,
    penaltyFreeCapacity,
  );
  if (shortfall <= 0) return 0;
  // Second pass: a residual past the penalty-free total comes from an
  // allowed account's exposed balance before any other account's
  // (capacity = full balance when allowed, else 0).
  const hasAllowedInList = accounts.some(
    (ia) => exposure.byKey.get(indKey(ia))?.allowPenalizedWithdrawals,
  );
  if (hasAllowedInList) {
    const allowedExposedCapacity = new Map<string, number>(
      accounts.map((ia) => {
        const k = indKey(ia);
        const allowed = exposure.byKey.get(k)?.allowPenalizedWithdrawals;
        return [k, allowed ? Math.max(0, indBalance.get(k) ?? 0) : 0];
      }),
    );
    const shortfall2 = distributeProportionally(
      shortfall,
      accounts,
      indKey,
      indBalance,
      withdrawalMap,
      allowedExposedCapacity,
    );
    // Still short after every allowed account: report it (reportShortfall,
    // in the caller); a disallowed account's exposed dollars stay
    // unreachable, so this is indBalance-vs-accountBalance drift.
    return shortfall2;
  }
  // Residual draws penalty-exposed money: whatever balance remains is the
  // exposed portion. Reached only when the household allows penalized
  // withdrawals (the lever off, or an account override).
  return distributeProportionally(
    shortfall,
    accounts,
    indKey,
    indBalance,
    withdrawalMap,
  );
}

/**
 * Spreads an amount by balance (or `min(balance, capacity)`), re-routing rounding residual through
 * the group. Mutates `indBalance` and `withdrawalMap`; returns what the group couldn't cover.
 */
function distributeProportionally(
  amount: number,
  accounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  withdrawalMap: Map<string, number>,
  capacity?: Map<string, number>,
): number {
  const room = (k: string): number => {
    const balance = Math.max(0, indBalance.get(k) ?? 0);
    const c = capacity?.get(k);
    return c != null ? Math.max(0, Math.min(balance, c)) : balance;
  };
  const total = accounts.reduce((s, ia) => s + room(indKey(ia)), 0);
  if (total <= 0) return amount;

  let distributed = 0;
  for (const ia of accounts) {
    const k = indKey(ia);
    const r = room(k);
    if (r <= 0) continue;
    const withdrawal = roundToCents(Math.min(amount * (r / total), r));
    if (withdrawal <= 0) continue;
    indBalance.set(k, roundToCents((indBalance.get(k) ?? 0) - withdrawal));
    withdrawalMap.set(k, (withdrawalMap.get(k) ?? 0) + withdrawal);
    distributed += withdrawal;
  }

  // Re-route rounding residual through the group in the same order, until
  // it's placed or the group's capacity is exhausted.
  let remaining = roundToCents(amount - distributed);
  for (const ia of accounts) {
    if (remaining <= 0) break;
    const k = indKey(ia);
    const r = room(k);
    if (r <= 0) continue;
    const draw = roundToCents(Math.min(remaining, r));
    if (draw <= 0) continue;
    indBalance.set(k, roundToCents((indBalance.get(k) ?? 0) - draw));
    withdrawalMap.set(k, (withdrawalMap.get(k) ?? 0) + draw);
    remaining = roundToCents(remaining - draw);
  }

  return Math.max(0, remaining);
}
