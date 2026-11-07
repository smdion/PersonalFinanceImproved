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
  indAccts: IndividualAccountInput[],
): IndividualAccountInput[] {
  return indAccts.filter(
    (ia) =>
      isOverflowTarget(ia.category) && !isRetirementMoney(ia.parentCategory),
  );
}

/** What the goal-funding accounts hold now (the most a goal can draw). */
export function goalFundingBalance(
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
): number {
  return roundToCents(
    goalFundingAccounts(indAccts).reduce(
      (s, ia) => s + Math.max(0, indBal.get(indKey(ia)) ?? 0),
      0,
    ),
  );
}

/**
 * Distribute a brokerage goal withdrawal across the goal-funding
 * (Portfolio-parented) brokerages, by balance. Mutates `indBal` in place.
 */
export function distributeGoalWithdrawal(
  drawAmount: number,
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
): void {
  const brokAccts = goalFundingAccounts(indAccts);
  const brokTotal = brokAccts.reduce(
    (s, ia) => s + Math.max(0, indBal.get(indKey(ia)) ?? 0),
    0,
  );
  for (const ia of brokAccts) {
    const k = indKey(ia);
    const weight =
      brokTotal > 0
        ? Math.max(0, indBal.get(k) ?? 0) / brokTotal
        : 1 / brokAccts.length;
    indBal.set(k, roundToCents((indBal.get(k) ?? 0) - drawAmount * weight));
  }
}

/**
 * Distribute slot-level withdrawals to individual accounts proportionally.
 * For roth_traditional categories, routes traditional and roth withdrawals
 * separately to the correct tax-type accounts.
 *
 * `eligibility` — when provided,
 * prefers eligible (not-yet-penalty-exposed) accounts within each
 * category/tax-slot before reaching into penalty-exposed ones. Has no
 * config lever, always applies: this is the fan-out-only preference,
 * distinct from and independent of `avoidPenalizedWithdrawals`'s
 * cross-category `routeForMode` behavior (Tier B) — it only ever changes
 * WHICH account inside an already-decided category/slot supplies a given
 * dollar, never the slot totals themselves.
 *
 * Mutates `indBal` in place. Returns per-account withdrawal amounts.
 */
/**
 * Distributes each slot's withdrawal across the individual accounts in its
 * category/tax-slice. Returns the per-account amounts plus any shortfall
 * warnings — a warning means
 * `Σ decIndWithdrawal` for that slot came up short of `slot.withdrawal`
 * because the individual-account track's balance was genuinely exhausted,
 * not silently discarded as it was before this pass. With
 * `reconcileIndividualToAggregate` running at end of year, this should be
 * an empty array for every fixture; a non-empty one is a real finding.
 */
export function distributeWithdrawals(
  slots: DecumulationSlot[],
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  eligibility?: EligibilityRecord,
  /** Traditional draws an owner's RMD fixes to an account (rmd-enforcement.ts
   *  `enforceOwnerRmds`): applied first; the rest of the slot fans out as usual. */
  pins?: ReadonlyMap<string, number>,
): { decIndWithdrawal: Map<string, number>; warnings: string[] } {
  const decIndWithdrawal = new Map<string, number>();
  const warnings: string[] = [];
  const reportShortfall = (shortfall: number, label: string) => {
    if (shortfall <= 0.005) return;
    warnings.push(
      `Individual-account shortfall: $${shortfall.toFixed(2)} of ${label} withdrawal could not be allocated to any tracked account`,
    );
  };

  for (const slot of slots) {
    if (slot.withdrawal <= 0) continue;
    // Portfolio-parented accounts are never a withdrawal fan-out
    // target — defense-in-depth alongside the category-level exclusion
    // routeForMode already applies (subtractExcluded); the category total
    // decided upstream should already fit within Retirement-parented
    // accounts' balances, so this filter should be a no-op in practice,
    // but it's what makes the exclusion a hard guarantee rather than
    // "should never happen if the upstream math is right."
    const catAccts = indAccts.filter(
      (ia) =>
        ia.category === slot.category && isRetirementMoney(ia.parentCategory),
    );
    const bs = getAccountTypeConfig(slot.category).balanceStructure;

    if (
      bs === "roth_traditional" &&
      (slot.traditionalWithdrawal > 0 || slot.rothWithdrawal > 0)
    ) {
      const tradAccts = catAccts.filter((ia) => isPreTaxType(ia.taxType));
      const rothAccts = catAccts.filter((ia) => isTaxFreeBucket(ia.taxType));

      // Distribute traditional withdrawal to preTax accounts (#33/#35)
      if (slot.traditionalWithdrawal > 0 && tradAccts.length > 0) {
        let pinned = 0;
        for (const ia of tradAccts) {
          const k = indKey(ia);
          const pin = pins?.get(k) ?? 0;
          if (pin <= 0) continue;
          indBal.set(k, roundToCents((indBal.get(k) ?? 0) - pin));
          decIndWithdrawal.set(k, (decIndWithdrawal.get(k) ?? 0) + pin);
          pinned = roundToCents(pinned + pin);
        }
        reportShortfall(
          distributeProportionallyPreferringPenaltyFree(
            roundToCents(slot.traditionalWithdrawal - pinned),
            tradAccts,
            indKey,
            indBal,
            decIndWithdrawal,
            eligibility,
          ),
          `${slot.category} traditional`,
        );
      }
      // Distribute roth withdrawal to taxFree accounts (#33/#35)
      if (slot.rothWithdrawal > 0 && rothAccts.length > 0) {
        reportShortfall(
          distributeProportionallyPreferringPenaltyFree(
            slot.rothWithdrawal,
            rothAccts,
            indKey,
            indBal,
            decIndWithdrawal,
            eligibility,
          ),
          `${slot.category} Roth`,
        );
      }
    } else {
      // Single-bucket / brokerage / fallback (#33/#35)
      if (catAccts.length > 0) {
        reportShortfall(
          distributeProportionallyPreferringPenaltyFree(
            slot.withdrawal,
            catAccts,
            indKey,
            indBal,
            decIndWithdrawal,
            eligibility,
          ),
          slot.category,
        );
      }
    }
  }

  return { decIndWithdrawal, warnings };
}

/**
 * Wraps `distributeProportionally` with a penalty-free-first, penalty-
 * exposed-second two-pass split (Tier A — see `distributeWithdrawals`'s
 * docblock).
 * Previously partitioned accounts by a whole-account "locked" boolean; now
 * partitions PER DOLLAR, using each account's own `penaltyFreeAmount` as a
 * draw ceiling rather than sorting whole accounts into two buckets — the
 * exact fix for the reported bug (a Roth IRA with some contribution basis
 * was never whole-account "locked", so its penalty-exposed growth was
 * reachable by the old partition even though the account was only
 * PARTIALLY penalty-free).
 *
 * Tier A has no config lever and always applies — it only decides which
 * INDIVIDUAL ACCOUNT within a category receives a category-level total
 * `routeForMode` already decided; when `avoidPenalizedWithdrawals` is on
 * (default), that category total already excludes penalty-exposed money
 * entirely, so the second (penalty-exposed) draw below should be
 * mathematically unreachable in the default configuration — reached only
 * when the household has the lever off, mirroring today's un-excluded
 * total.
 *
 * Falls through to a single unchanged `distributeProportionally` call
 * whenever the partition would be a no-op (no `exposure` passed, nothing
 * penalty-exposed at all, or nothing penalty-exposed among *this specific*
 * account list) — that fallthrough is what keeps a
 * nothing-penalty-exposed household's output byte-identical, not a
 * separate code path that has to be kept in sync.
 */
function distributeProportionallyPreferringPenaltyFree(
  amount: number,
  accounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  withdrawalMap: Map<string, number>,
  exposure: EligibilityRecord | undefined,
): number {
  if (!exposure || exposure.totalPenaltyExposed === 0) {
    return distributeProportionally(
      amount,
      accounts,
      indKey,
      indBal,
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
      indBal,
      withdrawalMap,
    );
  }
  // First pass: draw only against each account's own penalty-free capacity
  // (never more than its current balance).
  const penaltyFreeCapacity = new Map<string, number>(
    accounts.map((ia) => {
      const k = indKey(ia);
      const bal = Math.max(0, indBal.get(k) ?? 0);
      const acctExposure = exposure.byKey.get(k);
      return [
        k,
        acctExposure ? Math.min(bal, acctExposure.penaltyFreeAmount) : bal,
      ];
    }),
  );
  const shortfall = distributeProportionally(
    amount,
    accounts,
    indKey,
    indBal,
    withdrawalMap,
    penaltyFreeCapacity,
  );
  if (shortfall <= 0) return 0;
  // Second pass: a category pool that includes an allowed account's
  // penalty-exposed dollars (see `subtractPenaltyExposed`) can leave
  // `routeForMode` deciding to draw more than the penalty-free total — that
  // residual must come from an ALLOWED account's exposed balance before it
  // touches any other account's. Capacity here is the full remaining
  // balance for an allowed account, 0 for everyone else.
  const hasAllowedInList = accounts.some(
    (ia) => exposure.byKey.get(indKey(ia))?.allowPenalizedWithdrawals,
  );
  if (hasAllowedInList) {
    const allowedExposedCapacity = new Map<string, number>(
      accounts.map((ia) => {
        const k = indKey(ia);
        const allowed = exposure.byKey.get(k)?.allowPenalizedWithdrawals;
        return [k, allowed ? Math.max(0, indBal.get(k) ?? 0) : 0];
      }),
    );
    const shortfall2 = distributeProportionally(
      shortfall,
      accounts,
      indKey,
      indBal,
      withdrawalMap,
      allowedExposedCapacity,
    );
    // Still short even after every allowed account's exposed money —
    // report it (reportShortfall, in the caller) rather than falling
    // through to a disallowed sibling's exposed balance. A disallowed
    // account's penalty-exposed dollars must stay fully unreachable, even
    // when the allowed pool in this list can't cover the residual —
    // `routeForMode`'s category-level total already accounted for only the
    // allowed pool, so this really is a genuine indBal-vs-acctBal drift
    // case, not a place to silently spend a disallowed account's money.
    return shortfall2;
  }
  // Residual reaches into penalty-exposed capacity — no capacity ceiling
  // here, whatever balance remains at this point IS the exposed portion.
  // Structurally unreachable when `avoidPenalizedWithdrawals` is on and no
  // account in this list has the penalized-withdrawal override, mirroring the un-excluded
  // total when the household has the lever off entirely.
  return distributeProportionally(
    shortfall,
    accounts,
    indKey,
    indBal,
    withdrawalMap,
  );
}

/**
 * Distribute an amount proportionally across accounts by balance (or, when
 * `capacity` is supplied, by `min(balance, capacity)` per account — used by
 * `distributeProportionallyPreferringPenaltyFree` to draw against only the
 * penalty-free portion of each account's balance). Handles zero-balance
 * safety (#33) and rounding residual (#35 — replaced
 * the old single lastKey-only assignment with a bounded re-routing loop
 * across the whole group, so a residual that the first account can't fully
 * absorb re-routes to the next one with capacity instead of being silently
 * capped away). Mutates `indBal` and `withdrawalMap` in place. Returns any
 * amount that could not be allocated because the group's capacity was
 * genuinely exhausted — 0 in the overwhelmingly common case.
 */
function distributeProportionally(
  amount: number,
  accounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  withdrawalMap: Map<string, number>,
  capacity?: Map<string, number>,
): number {
  const room = (k: string): number => {
    const bal = Math.max(0, indBal.get(k) ?? 0);
    const c = capacity?.get(k);
    return c != null ? Math.max(0, Math.min(bal, c)) : bal;
  };
  const total = accounts.reduce((s, ia) => s + room(indKey(ia)), 0);
  if (total <= 0) return amount;

  let distributed = 0;
  for (const ia of accounts) {
    const k = indKey(ia);
    const r = room(k);
    if (r <= 0) continue;
    const wd = roundToCents(Math.min(amount * (r / total), r));
    if (wd <= 0) continue;
    indBal.set(k, roundToCents((indBal.get(k) ?? 0) - wd));
    withdrawalMap.set(k, (withdrawalMap.get(k) ?? 0) + wd);
    distributed += wd;
  }

  // Re-route any rounding residual within the same account group instead of
  // a single lastKey assignment — iterate in the same deterministic order,
  // drawing what's left from each account with remaining capacity, until
  // the residual is placed or the group's capacity is genuinely exhausted.
  let remaining = roundToCents(amount - distributed);
  for (const ia of accounts) {
    if (remaining <= 0) break;
    const k = indKey(ia);
    const r = room(k);
    if (r <= 0) continue;
    const draw = roundToCents(Math.min(remaining, r));
    if (draw <= 0) continue;
    indBal.set(k, roundToCents((indBal.get(k) ?? 0) - draw));
    withdrawalMap.set(k, (withdrawalMap.get(k) ?? 0) + draw);
    remaining = roundToCents(remaining - draw);
  }

  return Math.max(0, remaining);
}
