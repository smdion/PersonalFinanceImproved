/** Percentage routing: a year's withdrawal split by fixed shares. */
import type { DecumulationSlot } from "../types/routing";
import type { ResolvedDecumulationConfig } from "../types/decumulation";
import type { AccountBalances } from "../../accounts/account-balances.types";
import type { AccountCategory } from "../../../config/account-types";
import { roundToCents } from "../../../utils/math";
import {
  getAllCategories,
  getAccountTypeConfig,
} from "../../../config/account-types";
import {
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
} from "../../../config/account-balance";

/**
 * Route withdrawals by percentage split across accounts.
 * If an account has insufficient funds, its shortfall redistributes proportionally.
 */
export function routeWithdrawalsPercentage(
  targetWithdrawal: number,
  config: ResolvedDecumulationConfig,
  balances: AccountBalances,
): { slots: DecumulationSlot[]; warnings: string[]; unmetNeed?: number } {
  const warnings: string[] = [];

  // Calculate available balance per account
  const available: Record<AccountCategory, number> = Object.fromEntries(
    getAllCategories().map((cat) => [cat, getTotalBalance(balances[cat])]),
  ) as Record<AccountCategory, number>;

  // Initial allocation by split percentage
  const targets: Record<AccountCategory, number> = Object.fromEntries(
    getAllCategories().map((cat) => [
      cat,
      roundToCents(targetWithdrawal * (config.withdrawalSplits[cat] ?? 0)),
    ]),
  ) as Record<AccountCategory, number>;

  // Apply account caps and clamp to available balance
  let excess = 0;
  const cappedAccounts = new Set<AccountCategory>();
  for (const cat of getAllCategories()) {
    const accountCap = config.withdrawalAccountCaps[cat];
    // A cap moves the cut-off share to other accounts like an emptied
    // account's does (it was dropped: delivered short with no unmet need).
    if (accountCap !== null && targets[cat] > accountCap) {
      excess += roundToCents(targets[cat] - accountCap);
      targets[cat] = accountCap;
      cappedAccounts.add(cat);
    }
    if (targets[cat] > available[cat]) {
      excess += roundToCents(targets[cat] - available[cat]);
      targets[cat] = available[cat];
      cappedAccounts.add(cat);
    }
  }

  // Redistribute the excess to accounts with room left, by split — repeated
  // until it's placed, since an account taking extra can run dry in turn
  // (one pass left that remainder "unmet" beside full accounts). Accounts
  // with a 0% split take what's left after the split ones are full: the
  // split is the mix the household prefers, not a ban on other money.
  // Accounts a tax-type cap has stopped (below) take no more.
  const stopped = new Set<AccountCategory>();
  const roomOf = (c: AccountCategory) => {
    if (stopped.has(c)) return 0;
    const cap = config.withdrawalAccountCaps[c];
    const limit = cap !== null ? Math.min(available[c], cap) : available[c];
    return roundToCents(Math.max(0, limit - targets[c]));
  };
  const placeExcess = () => {
    for (
      let pass = 0;
      excess > 0.01 && pass < getAllCategories().length * 2;
      pass++
    ) {
      const withRoom = getAllCategories().filter((c) => roomOf(c) > 0);
      if (withRoom.length === 0) break;
      const splitWeighted = withRoom.filter(
        (c) => (config.withdrawalSplits[c] ?? 0) > 0,
      );
      const pool = splitWeighted.length > 0 ? splitWeighted : withRoom;
      const weightOf = (c: AccountCategory) =>
        splitWeighted.length > 0
          ? (config.withdrawalSplits[c] ?? 0)
          : roomOf(c);
      const totalWeight = pool.reduce((t, c) => t + weightOf(c), 0);
      if (totalWeight <= 0) break;
      const toPlace = excess;
      for (const cat of pool) {
        const extra = roundToCents(
          Math.min(toPlace * (weightOf(cat) / totalWeight), roomOf(cat)),
        );
        targets[cat] = roundToCents(targets[cat] + extra);
        excess = roundToCents(excess - extra);
      }
    }
  };
  placeExcess();

  // Build slots with tax-type routing within each account. A tax-type cap can
  // cut an account below its target: the cut moves on like any other (it
  // was dropped: delivered short with no unmet need), and the slots rebuild.
  const buildSlots = () => {
    const slots: DecumulationSlot[] = [];
    let totalTradWithdrawn = 0;
    let totalRothWithdrawn = 0;

    for (const category of getAllCategories()) {
      const withdrawal = targets[category];
      let rothWithdrawal = 0;
      let tradWithdrawal = 0;
      let cappedByTaxType = false;

      if (getAccountTypeConfig(category).balanceStructure === "single_bucket") {
        tradWithdrawal = withdrawal;
      } else if (!getAccountTypeConfig(category).supportsRothSplit) {
        // Non-split accounts (e.g. brokerage): neither roth nor traditional
      } else {
        const balance = balances[category];
        const tradBalance = getTraditionalBalance(balance);
        const rothBalance = getRothBalance(balance);
        const taxPref = config.withdrawalTaxPreference[category];
        if (taxPref === "traditional" || taxPref === null) {
          tradWithdrawal = roundToCents(Math.min(withdrawal, tradBalance));
          rothWithdrawal = roundToCents(
            Math.min(withdrawal - tradWithdrawal, rothBalance),
          );
        } else {
          rothWithdrawal = roundToCents(Math.min(withdrawal, rothBalance));
          tradWithdrawal = roundToCents(
            Math.min(withdrawal - rothWithdrawal, tradBalance),
          );
        }

        // Cross-account tax-type caps
        const tradCap = config.withdrawalTaxTypeCaps.traditional;
        if (tradCap !== null && totalTradWithdrawn + tradWithdrawal > tradCap) {
          const allowed = roundToCents(
            Math.max(0, tradCap - totalTradWithdrawn),
          );
          const excessTrad = roundToCents(tradWithdrawal - allowed);
          tradWithdrawal = allowed;
          const extraRoth = roundToCents(
            Math.min(excessTrad, rothBalance - rothWithdrawal),
          );
          rothWithdrawal += extraRoth;
          cappedByTaxType = true;
        }
        const rothCap = config.withdrawalTaxTypeCaps.roth;
        if (rothCap !== null && totalRothWithdrawn + rothWithdrawal > rothCap) {
          const allowed = roundToCents(
            Math.max(0, rothCap - totalRothWithdrawn),
          );
          const excessRoth = roundToCents(rothWithdrawal - allowed);
          rothWithdrawal = allowed;
          const extraTrad = roundToCents(
            Math.min(excessRoth, tradBalance - tradWithdrawal),
          );
          tradWithdrawal += extraTrad;
          cappedByTaxType = true;
        }
      }

      totalTradWithdrawn += tradWithdrawal;
      totalRothWithdrawn += rothWithdrawal;

      const accountCap = config.withdrawalAccountCaps[category];
      slots.push({
        category,
        withdrawal: roundToCents(
          !getAccountTypeConfig(category).supportsRothSplit
            ? withdrawal
            : tradWithdrawal + rothWithdrawal,
        ),
        rothWithdrawal,
        traditionalWithdrawal: tradWithdrawal,
        cappedByAccount: accountCap !== null && withdrawal >= accountCap,
        cappedByTaxType,
        remainingNeed: 0,
      });
    }
    return slots;
  };

  let builtSlots = buildSlots();
  for (let pass = 0; pass < getAllCategories().length * 2; pass++) {
    const cut = builtSlots.filter(
      (s) => targets[s.category] - s.withdrawal > 0.01,
    );
    if (cut.length === 0) break;
    for (const s of cut) {
      excess = roundToCents(excess + targets[s.category] - s.withdrawal);
      targets[s.category] = s.withdrawal;
      stopped.add(s.category);
    }
    placeExcess();
    builtSlots = buildSlots();
  }
  if (excess > 0) {
    warnings.push(
      `$${excess.toLocaleString()} withdrawal need unmet — insufficient funds across all accounts`,
    );
  }
  const unmetNeed = excess > 0 ? roundToCents(excess) : undefined;
  return { slots: builtSlots, warnings, unmetNeed };
}
