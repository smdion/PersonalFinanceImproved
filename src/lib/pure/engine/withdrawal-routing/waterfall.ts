/** Waterfall routing: accounts drained in the household's order, with caps. */
import type { DecumulationSlot } from "../types/routing";
import type { ResolvedDecumulationConfig } from "../types/decumulation";
import type { AccountBalances } from "../../accounts/account-balances.types";
import { roundToCents } from "../../../utils/math";
import {
  getAccountTypeConfig,
  isOverflowTarget,
} from "../../../config/account-types";
import {
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
} from "../../../config/account-balance";
import type { RouteResult } from "./types";

/**
 * Route withdrawals from accounts for one year.
 * Draws from accounts in withdrawal order, respecting caps and tax preferences.
 */
export function routeWithdrawals(
  targetWithdrawal: number,
  config: ResolvedDecumulationConfig,
  balances: AccountBalances,
): RouteResult {
  const warnings: string[] = [];
  let remaining = targetWithdrawal;
  const slots: DecumulationSlot[] = [];

  let totalTradWithdrawn = 0;
  let totalRothWithdrawn = 0;

  for (const category of config.withdrawalOrder) {
    if (remaining <= 0) {
      slots.push({
        category,
        withdrawal: 0,
        rothWithdrawal: 0,
        traditionalWithdrawal: 0,
        cappedByAccount: false,
        cappedByTaxType: false,
        remainingNeed: 0,
      });
      continue;
    }

    const accountCap = config.withdrawalAccountCaps[category];
    const maxFromAccount =
      accountCap !== null ? Math.min(remaining, accountCap) : remaining;

    let withdrawal = 0;
    let rothWithdrawal = 0;
    let tradWithdrawal = 0;
    let cappedByTaxType = false;

    if (getAccountTypeConfig(category).balanceStructure === "single_bucket") {
      // Single bucket (e.g. HSA): always pre-tax withdrawal
      const available = getTotalBalance(balances[category]);
      withdrawal = roundToCents(Math.min(maxFromAccount, available));
      tradWithdrawal = withdrawal; // HSA withdrawals are "traditional" for tax purposes
    } else if (isOverflowTarget(category)) {
      // Overflow target (e.g. brokerage): single bucket, after-tax
      const available = getTotalBalance(balances[category]);
      withdrawal = roundToCents(Math.min(maxFromAccount, available));
      // Brokerage is neither roth nor traditional — tracked separately
    } else {
      // Roth/Traditional split accounts (401k, 403b, IRA)
      const bal = balances[category];
      const tradBalance = getTraditionalBalance(bal);
      const rothBalance = getRothBalance(bal);
      const taxPref = config.withdrawalTaxPreference[category];
      const available = tradBalance + rothBalance;
      const canDraw = roundToCents(Math.min(maxFromAccount, available));

      if (taxPref === "traditional" || taxPref === null) {
        // Draw traditional first, then roth
        tradWithdrawal = roundToCents(Math.min(canDraw, tradBalance));
        rothWithdrawal = roundToCents(
          Math.min(canDraw - tradWithdrawal, rothBalance),
        );
      } else {
        // Draw roth first, then traditional
        rothWithdrawal = roundToCents(Math.min(canDraw, rothBalance));
        tradWithdrawal = roundToCents(
          Math.min(canDraw - rothWithdrawal, tradBalance),
        );
      }

      // Check cross-account tax-type caps
      const tradCap = config.withdrawalTaxTypeCaps.traditional;
      if (tradCap !== null && totalTradWithdrawn + tradWithdrawal > tradCap) {
        const allowed = roundToCents(Math.max(0, tradCap - totalTradWithdrawn));
        const excess = roundToCents(tradWithdrawal - allowed);
        tradWithdrawal = allowed;
        // Try to take excess from roth instead
        const extraRoth = roundToCents(
          Math.min(excess, rothBalance - rothWithdrawal),
        );
        rothWithdrawal = roundToCents(rothWithdrawal + extraRoth);
        cappedByTaxType = true;
        if (excess > extraRoth) {
          warnings.push(
            `Traditional withdrawal cap hit — $${roundToCents(excess - extraRoth).toLocaleString()} unmet from ${category}`,
          );
        }
      }
      const rothCap = config.withdrawalTaxTypeCaps.roth;
      if (rothCap !== null && totalRothWithdrawn + rothWithdrawal > rothCap) {
        const allowed = roundToCents(Math.max(0, rothCap - totalRothWithdrawn));
        const excess = roundToCents(rothWithdrawal - allowed);
        rothWithdrawal = allowed;
        const extraTrad = roundToCents(
          Math.min(excess, tradBalance - tradWithdrawal),
        );
        tradWithdrawal = roundToCents(tradWithdrawal + extraTrad);
        cappedByTaxType = true;
      }

      withdrawal = roundToCents(tradWithdrawal + rothWithdrawal);
    }

    totalTradWithdrawn += tradWithdrawal;
    totalRothWithdrawn += rothWithdrawal;
    remaining = roundToCents(remaining - withdrawal);

    const cappedByAccount = accountCap !== null && withdrawal >= accountCap;

    slots.push({
      category,
      withdrawal,
      rothWithdrawal,
      traditionalWithdrawal: tradWithdrawal,
      cappedByAccount,
      cappedByTaxType,
      remainingNeed: remaining > 0 ? remaining : 0,
    });

    if (cappedByAccount && remaining > 0 && accountCap! > 0) {
      warnings.push(
        `${category} withdrawal capped at $${accountCap!.toLocaleString()} — ` +
          `$${remaining.toLocaleString()} shifts to next account`,
      );
    }
  }

  // Handle accounts not in withdrawal order (shouldn't happen but safety)
  if (remaining > 0) {
    warnings.push(
      `$${remaining.toLocaleString()} withdrawal need unmet — insufficient funds across all accounts`,
    );
  }

  return {
    slots,
    warnings,
    unmetNeed: remaining > 0 ? roundToCents(remaining) : undefined,
  };
}
