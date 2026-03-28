/**
 * RMD Enforcement — ensures minimum Traditional withdrawals per IRS rules.
 *
 * After withdrawal routing decides allocations, this module enforces the
 * Required Minimum Distribution. If Traditional withdrawals are below the
 * RMD floor, the shortfall is distributed proportionally across Traditional
 * accounts. Applies to ALL routing modes.
 */
import type { DecumulationSlot, AccountCategory } from "../types";
import { roundToCents } from "../../utils/math";
import type { AccountBalances } from "../types";
import {
  categoriesWithTaxPreference,
  getTraditionalBalance,
} from "../../config/account-types";
import { getRmdFactor } from "../../config/rmd-tables";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RmdEnforcementInput {
  age: number;
  rmdStartAge: number | null;
  priorYearEndTradBalance: number;
  slots: DecumulationSlot[];
  totalTraditionalWithdrawal: number;
  totalWithdrawal: number;
  acctBal: AccountBalances;
  /** When provided, overrides the internal RMD calculation (used for per-person RMD). */
  overrideRmdRequired?: number;
}

export interface RmdEnforcementResult {
  rmdAmount: number;
  rmdOverrodeRouting: boolean;
  totalTraditionalWithdrawal: number;
  totalWithdrawal: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Enforce IRS Required Minimum Distribution on Traditional withdrawals.
 *
 * Mutates `slots` in place (adds RMD shortfall to existing slots or creates
 * new ones). Returns updated totals and diagnostic info.
 */
export function enforceRmd(input: RmdEnforcementInput): RmdEnforcementResult {
  const { age, rmdStartAge, priorYearEndTradBalance, slots, acctBal } = input;
  let { totalTraditionalWithdrawal, totalWithdrawal } = input;

  const warnings: string[] = [];
  let rmdAmount = 0;
  let rmdOverrodeRouting = false;

  if (
    (input.overrideRmdRequired != null && input.overrideRmdRequired > 0) ||
    (rmdStartAge != null && age >= rmdStartAge && priorYearEndTradBalance > 0)
  ) {
    const factor = getRmdFactor(age);
    if (input.overrideRmdRequired != null || (factor != null && factor > 0)) {
      const rmdRequired =
        input.overrideRmdRequired ??
        roundToCents(priorYearEndTradBalance / factor!);
      rmdAmount = rmdRequired;
      if (totalTraditionalWithdrawal < rmdRequired) {
        const rmdShortfall = roundToCents(
          rmdRequired - totalTraditionalWithdrawal,
        );
        rmdOverrodeRouting = true;
        // Distribute shortfall proportionally across roth_traditional accounts
        // based on their current Traditional balance.
        const tradCategories = categoriesWithTaxPreference();
        // Compute available capacity per category: balance minus what routing already took
        const tradBalByCategory = tradCategories.map((cat) => {
          const fullBal = getTraditionalBalance(acctBal[cat]);
          const alreadyRouted =
            slots.find((s) => s.category === cat)?.traditionalWithdrawal ?? 0;
          return {
            cat,
            bal: Math.max(0, roundToCents(fullBal - alreadyRouted)),
          };
        });
        const totalTradBal = tradBalByCategory.reduce((s, x) => s + x.bal, 0);
        let distributed = 0;
        if (totalTradBal > 0) {
          // Multi-pass distribution: proportional allocation with cap redistribution.
          const allocated = new Map<AccountCategory, number>();
          const capped = new Set<AccountCategory>();
          let remaining = rmdShortfall;

          while (remaining > 0.01) {
            const uncappedEntries = tradBalByCategory.filter(
              ({ cat, bal }) => bal > 0 && !capped.has(cat),
            );
            const uncappedBal = uncappedEntries.reduce((s, x) => s + x.bal, 0);
            if (uncappedBal <= 0) break;

            let passDistributed = 0;
            for (const { cat, bal } of uncappedEntries) {
              const share = roundToCents(remaining * (bal / uncappedBal));
              const prior = allocated.get(cat) ?? 0;
              const maxForCat = roundToCents(bal - prior);
              const actual = Math.min(share, Math.max(0, maxForCat));
              if (actual < share) capped.add(cat);
              allocated.set(cat, roundToCents(prior + actual));
              passDistributed += actual;
            }
            remaining = roundToCents(remaining - passDistributed);
            if (passDistributed < 0.01) break;
          }

          // Apply allocations to slots, assign rounding residual to last
          let lastSlot: DecumulationSlot | null = null;
          for (const { cat } of tradBalByCategory) {
            const amount = allocated.get(cat) ?? 0;
            if (amount <= 0) continue;
            let slot = slots.find((s) => s.category === cat);
            if (slot) {
              slot.traditionalWithdrawal = roundToCents(
                slot.traditionalWithdrawal + amount,
              );
              slot.withdrawal = roundToCents(slot.withdrawal + amount);
            } else {
              slot = {
                category: cat,
                withdrawal: amount,
                traditionalWithdrawal: amount,
                rothWithdrawal: 0,
              } as DecumulationSlot;
              slots.push(slot);
            }
            distributed += amount;
            lastSlot = slot;
          }
          // Assign rounding residual to last category
          const residual = roundToCents(rmdShortfall - distributed);
          if (residual > 0 && lastSlot) {
            lastSlot.traditionalWithdrawal = roundToCents(
              lastSlot.traditionalWithdrawal + residual,
            );
            lastSlot.withdrawal = roundToCents(lastSlot.withdrawal + residual);
            distributed += residual;
          }
        }
        totalTraditionalWithdrawal = roundToCents(
          totalTraditionalWithdrawal + distributed,
        );
        totalWithdrawal = roundToCents(totalWithdrawal + distributed);
        if (distributed < rmdShortfall - 0.01) {
          const penalty = roundToCents(
            (rmdRequired - totalTraditionalWithdrawal) * 0.25,
          );
          warnings.push(
            `RMD SHORTFALL: Required $${rmdRequired.toFixed(0)} but only $${totalTraditionalWithdrawal.toFixed(0)} Traditional available. ` +
              `IRS penalty (25% excise tax) on the $${(rmdRequired - totalTraditionalWithdrawal).toFixed(0)} shortfall would be ~$${penalty.toFixed(0)}. ` +
              `Consider Roth conversions or other strategies to meet RMD obligations.`,
          );
        }
      }
    }
  }

  return {
    rmdAmount,
    rmdOverrodeRouting,
    totalTraditionalWithdrawal,
    totalWithdrawal,
    warnings,
  };
}
