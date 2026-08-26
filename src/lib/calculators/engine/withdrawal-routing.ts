/**
 * Withdrawal Routing — decumulation-phase withdrawal distribution.
 *
 * Three routing modes for distributing withdrawals across accounts:
 *   - routeWithdrawals: waterfall (sequential drain in priority order)
 *   - routeWithdrawalsPercentage: fixed % split across accounts
 *   - routeWithdrawalsBracketFilling: tax-optimal bracket filling
 *
 * All functions receive ResolvedDecumulationConfig — never raw overrides.
 */
import type {
  DecumulationSlot,
  ResolvedDecumulationConfig,
  AccountBalances,
  AccountCategory,
} from "../types";
import { roundToCents } from "../../utils/math";
import {
  getAllCategories,
  getAccountTypeConfig,
  isOverflowTarget,
  categoriesWithTaxPreference,
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
  getDefaultDecumulationOrder,
} from "../../config/account-types";
import { incomeCapForMarginalRate } from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";
import { subtractPenaltyExposed } from "./balance-utils";
import type { EligibilityRecord } from "@/lib/pure/withdrawal-eligibility";

const ACCOUNT_CATEGORIES: AccountCategory[] = getAllCategories();

/**
 * Route withdrawals from accounts for one year.
 * Draws from accounts in withdrawal order, respecting caps and tax preferences.
 */
export function routeWithdrawals(
  targetWithdrawal: number,
  config: ResolvedDecumulationConfig,
  balances: AccountBalances,
): { slots: DecumulationSlot[]; warnings: string[]; unmetNeed?: number } {
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

    if (cappedByAccount && remaining > 0) {
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
  const slots: DecumulationSlot[] = [];

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
  for (const cat of ACCOUNT_CATEGORIES) {
    const accountCap = config.withdrawalAccountCaps[cat];
    if (accountCap !== null) targets[cat] = Math.min(targets[cat], accountCap);
    if (targets[cat] > available[cat]) {
      excess += roundToCents(targets[cat] - available[cat]);
      targets[cat] = available[cat];
      cappedAccounts.add(cat);
    }
  }

  // Redistribute excess proportionally to uncapped accounts with remaining capacity
  if (excess > 0) {
    const uncapped = ACCOUNT_CATEGORIES.filter(
      (c) => !cappedAccounts.has(c) && available[c] > targets[c],
    );
    const uncappedTotal = uncapped.reduce(
      (s, c) => s + (config.withdrawalSplits[c] ?? 0),
      0,
    );
    if (uncappedTotal > 0) {
      for (const cat of uncapped) {
        const share = (config.withdrawalSplits[cat] ?? 0) / uncappedTotal;
        const extra = roundToCents(
          Math.min(excess * share, available[cat] - targets[cat]),
        );
        targets[cat] += extra;
        excess = roundToCents(excess - extra);
      }
    }
    if (excess > 0) {
      warnings.push(
        `$${excess.toLocaleString()} withdrawal need unmet — insufficient funds across all accounts`,
      );
    }
  }
  const unmetNeed = excess > 0 ? roundToCents(excess) : undefined;

  // Build slots with tax-type routing within each account
  let totalTradWithdrawn = 0;
  let totalRothWithdrawn = 0;

  for (const category of ACCOUNT_CATEGORIES) {
    const withdrawal = targets[category];
    let rothWithdrawal = 0;
    let tradWithdrawal = 0;
    let cappedByTaxType = false;

    if (getAccountTypeConfig(category).balanceStructure === "single_bucket") {
      tradWithdrawal = withdrawal;
    } else if (!getAccountTypeConfig(category).supportsRothSplit) {
      // Non-split accounts (e.g. brokerage): neither roth nor traditional
    } else {
      const bal = balances[category];
      const tradBalance = getTraditionalBalance(bal);
      const rothBalance = getRothBalance(bal);
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
        const allowed = roundToCents(Math.max(0, tradCap - totalTradWithdrawn));
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
        const allowed = roundToCents(Math.max(0, rothCap - totalRothWithdrawn));
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

  return { slots, warnings, unmetNeed };
}

/**
 * Route withdrawals using bracket-filling strategy.
 *
 * Instead of draining accounts sequentially (waterfall) or splitting by fixed %
 * (percentage), this mode optimizes tax efficiency each year:
 *
 * 1. Fill traditional withdrawals (401k/IRA traditional) up to a tax bracket cap.
 *    This uses the cheap bracket space without overfilling into expensive brackets.
 * 2. Fill remaining need from Roth (401k/IRA Roth) — tax-free, no bracket impact.
 * 3. Use brokerage as overflow (capital gains rate, usually lower than income).
 * 4. HSA is last resort — most tax-advantaged, let it compound longest.
 *
 * The bracket cap is determined by `rothBracketTarget` (target marginal rate).
 * If no brackets or target are provided, falls back to waterfall behavior.
 */
export function routeWithdrawalsBracketFilling(
  targetWithdrawal: number,
  config: ResolvedDecumulationConfig,
  balances: AccountBalances,
  bracketInfo: {
    taxBrackets?: WithholdingBracket[];
    rothBracketTarget?: number;
    taxableSS: number;
  },
): {
  slots: DecumulationSlot[];
  warnings: string[];
  traditionalCap?: number;
  unmetNeed?: number;
} {
  const warnings: string[] = [];

  // If we don't have brackets or a target, fall back to waterfall
  if (
    !bracketInfo.taxBrackets ||
    bracketInfo.taxBrackets.length === 0 ||
    bracketInfo.rothBracketTarget == null
  ) {
    return routeWithdrawals(targetWithdrawal, config, balances);
  }

  // Compute the traditional income cap: max traditional withdrawals before
  // exceeding the target marginal bracket, minus SS income already occupying
  // that bracket space.
  const incomeCap = incomeCapForMarginalRate(
    bracketInfo.rothBracketTarget,
    bracketInfo.taxBrackets,
  );
  const traditionalCap = roundToCents(
    Math.max(0, incomeCap - bracketInfo.taxableSS),
  );

  let remaining = targetWithdrawal;
  const slots: DecumulationSlot[] = [];
  let totalTradWithdrawn = 0;
  let totalRothWithdrawn = 0;
  // Track how much has been withdrawn from each category across phases
  const categoryWithdrawn = new Map<string, number>();

  const tradTypeCap = config.withdrawalTaxTypeCaps.traditional;
  const rothTypeCap = config.withdrawalTaxTypeCaps.roth;

  // --- Phase 1: Traditional from 401k/403b + IRA up to bracket cap ---
  for (const category of categoriesWithTaxPreference()) {
    if (remaining <= 0 || totalTradWithdrawn >= traditionalCap) break;

    const accountCap = config.withdrawalAccountCaps[category];
    const catDrawn = categoryWithdrawn.get(category) ?? 0;
    const accountRoom =
      accountCap !== null ? Math.max(0, accountCap - catDrawn) : Infinity;

    const tradAvailable = getTraditionalBalance(balances[category]);
    const tradRoom = roundToCents(traditionalCap - totalTradWithdrawn);
    // Also respect tax-type cap on traditional withdrawals
    const tradTypeRoom =
      tradTypeCap !== null
        ? Math.max(0, tradTypeCap - totalTradWithdrawn)
        : Infinity;
    const tradDraw = roundToCents(
      Math.min(remaining, tradRoom, tradAvailable, accountRoom, tradTypeRoom),
    );

    if (tradDraw > 0) {
      remaining = roundToCents(remaining - tradDraw);
      totalTradWithdrawn += tradDraw;
      categoryWithdrawn.set(category, catDrawn + tradDraw);

      slots.push({
        category,
        withdrawal: tradDraw,
        rothWithdrawal: 0,
        traditionalWithdrawal: tradDraw,
        cappedByAccount: accountCap !== null && tradDraw >= accountRoom,
        cappedByTaxType:
          tradDraw >= tradRoom ||
          (tradTypeCap !== null && tradDraw >= tradTypeRoom),
        remainingNeed: remaining > 0 ? remaining : 0,
      });
    }
  }

  // --- Phase 2: Roth from 401k/403b + IRA (tax-free, no bracket impact) ---
  for (const category of categoriesWithTaxPreference()) {
    if (remaining <= 0) break;

    const accountCap = config.withdrawalAccountCaps[category];
    const catDrawn = categoryWithdrawn.get(category) ?? 0;
    const accountRoom =
      accountCap !== null ? Math.max(0, accountCap - catDrawn) : Infinity;
    const rothTypeRoom =
      rothTypeCap !== null
        ? Math.max(0, rothTypeCap - totalRothWithdrawn)
        : Infinity;

    const rothAvailable = getRothBalance(balances[category]);
    const rothDraw = roundToCents(
      Math.min(remaining, rothAvailable, accountRoom, rothTypeRoom),
    );

    if (rothDraw > 0) {
      remaining = roundToCents(remaining - rothDraw);
      totalRothWithdrawn += rothDraw;
      categoryWithdrawn.set(category, catDrawn + rothDraw);

      // Merge with existing slot for this category if we already drew traditional
      const existing = slots.find((s) => s.category === category);
      if (existing) {
        existing.rothWithdrawal = rothDraw;
        existing.withdrawal = roundToCents(existing.withdrawal + rothDraw);
        existing.cappedByAccount =
          existing.cappedByAccount ||
          (accountCap !== null && rothDraw >= accountRoom);
        existing.cappedByTaxType =
          existing.cappedByTaxType ||
          (rothTypeCap !== null && rothDraw >= rothTypeRoom);
        existing.remainingNeed = remaining > 0 ? remaining : 0;
      } else {
        slots.push({
          category,
          withdrawal: rothDraw,
          rothWithdrawal: rothDraw,
          traditionalWithdrawal: 0,
          cappedByAccount: accountCap !== null && rothDraw >= accountRoom,
          cappedByTaxType: rothTypeCap !== null && rothDraw >= rothTypeRoom,
          remainingNeed: remaining > 0 ? remaining : 0,
        });
      }
    }
  }

  // --- Phase 3: Overflow target (e.g. brokerage — capital gains rate) ---
  const overflowCats = ACCOUNT_CATEGORIES.filter(isOverflowTarget);
  for (const brokCat of overflowCats) {
    if (remaining <= 0) break;
    const accountCap = config.withdrawalAccountCaps[brokCat];
    const accountRoom = accountCap !== null ? accountCap : Infinity;
    const available = getTotalBalance(balances[brokCat]);
    const draw = roundToCents(Math.min(remaining, available, accountRoom));
    if (draw > 0) {
      remaining = roundToCents(remaining - draw);
    }
    slots.push({
      category: brokCat,
      withdrawal: draw,
      rothWithdrawal: 0,
      traditionalWithdrawal: 0,
      cappedByAccount: accountCap !== null && draw >= accountRoom,
      cappedByTaxType: false,
      remainingNeed: remaining > 0 ? remaining : 0,
    });
  }

  // --- Phase 4: Single-bucket accounts last resort (e.g. HSA — most tax-advantaged) ---
  const singleBucketCats = ACCOUNT_CATEGORIES.filter(
    (cat) => getAccountTypeConfig(cat).balanceStructure === "single_bucket",
  );
  for (const sbCat of singleBucketCats) {
    if (remaining > 0) {
      const accountCap = config.withdrawalAccountCaps[sbCat];
      const accountRoom = accountCap !== null ? accountCap : Infinity;
      const available = getTotalBalance(balances[sbCat]);
      const draw = roundToCents(Math.min(remaining, available, accountRoom));
      if (draw > 0) {
        remaining = roundToCents(remaining - draw);
      }
      slots.push({
        category: sbCat,
        withdrawal: draw,
        rothWithdrawal: 0,
        traditionalWithdrawal: draw, // Single-bucket = pre-tax for tax purposes
        cappedByAccount: accountCap !== null && draw >= accountRoom,
        cappedByTaxType: false,
        remainingNeed: remaining > 0 ? remaining : 0,
      });
    } else {
      // Include slot with zero withdrawal for consistency
      slots.push({
        category: sbCat,
        withdrawal: 0,
        rothWithdrawal: 0,
        traditionalWithdrawal: 0,
        cappedByAccount: false,
        cappedByTaxType: false,
        remainingNeed: 0,
      });
    }
  }

  // Ensure all 4 categories have slots (brokerage might be missing if not needed)
  for (const cat of ACCOUNT_CATEGORIES) {
    if (!slots.find((s) => s.category === cat)) {
      slots.push({
        category: cat,
        withdrawal: 0,
        rothWithdrawal: 0,
        traditionalWithdrawal: 0,
        cappedByAccount: false,
        cappedByTaxType: false,
        remainingNeed: 0,
      });
    }
  }

  if (remaining > 0) {
    warnings.push(
      `$${remaining.toLocaleString()} withdrawal need unmet — insufficient funds across all accounts`,
    );
  }

  return {
    slots,
    warnings,
    traditionalCap,
    unmetNeed: remaining > 0 ? remaining : undefined,
  };
}

// ---------------------------------------------------------------------------
// Mode dispatch — single entry point so real execution and tax-gross-up.ts's
// estimate can never route differently for the same inputs (Phase 5 item 5.3).
// ---------------------------------------------------------------------------

export interface RouteBracketInfo {
  taxBrackets?: WithholdingBracket[];
  rothBracketTarget?: number;
  taxableSS: number;
}

export type RouteResult = {
  slots: DecumulationSlot[];
  warnings: string[];
  traditionalCap?: number;
  unmetNeed?: number;
  /** Portion of `unmetNeed` attributable specifically to excluding
   *  penalty-exposed money, not to the household being broke (v0.7.8
   *  penalty-hard-exclusion follow-up, DESIGN-DECISION-v0.7.8-
   *  penalty-hard-exclusion.md § Q3/C2). Distinct from `unmetNeed` itself:
   *  a household can be short for BOTH reasons, or either alone — conflating
   *  them would destroy the distinction this whole feature exists to
   *  create. `min(unmetNeed, exposure.totalPenaltyExposed)` — never more
   *  than either the amount actually unfunded or the amount that was
   *  actually excluded. */
  penaltyAvoidedShortfall?: number;
};

/**
 * Apply the Roth-bracket-optimization overlay to a waterfall config: caps
 * cross-account traditional withdrawals at the income level that keeps the
 * target marginal bracket, and forces traditional preference on Roth-split
 * categories the user hasn't explicitly set a preference on. No-op (returns
 * the same config) when no rothBracketTarget is configured or there's no
 * bracket data to compute a cap from.
 */
export function applyRothBracketOverlay(
  config: ResolvedDecumulationConfig,
  bracketInfo: RouteBracketInfo,
): ResolvedDecumulationConfig {
  if (
    bracketInfo.rothBracketTarget == null ||
    !bracketInfo.taxBrackets ||
    bracketInfo.taxBrackets.length === 0
  ) {
    return config;
  }
  const incomeCap = incomeCapForMarginalRate(
    bracketInfo.rothBracketTarget,
    bracketInfo.taxBrackets,
  );
  const rothOptTraditionalCap = roundToCents(
    Math.max(0, incomeCap - bracketInfo.taxableSS),
  );
  // Written as a negation of "< Infinity" (not ">= Infinity") so a NaN cap
  // (shouldn't happen, but taxableSS/incomeCap are computed values) takes
  // the same no-overlay path as the original inline logic did — NaN
  // comparisons are always false either way, but ">=" would silently flip
  // which branch that lands on.
  if (!(rothOptTraditionalCap < Infinity)) return config;

  const existingTradCap = config.withdrawalTaxTypeCaps.traditional;
  const tradOverrides = Object.fromEntries(
    categoriesWithTaxPreference()
      .filter((cat) => config.withdrawalTaxPreference[cat] === null)
      .map((cat) => [cat, "traditional" as const]),
  );
  return {
    ...config,
    withdrawalTaxTypeCaps: {
      ...config.withdrawalTaxTypeCaps,
      traditional:
        existingTradCap !== null
          ? Math.min(rothOptTraditionalCap, existingTradCap)
          : rothOptTraditionalCap,
    },
    withdrawalTaxPreference: {
      ...config.withdrawalTaxPreference,
      ...tradOverrides,
    },
    withdrawalOrder: getDefaultDecumulationOrder(),
  };
}

/**
 * One dispatch to whichever mode config.withdrawalRoutingMode selects —
 * extracted verbatim from the pre-v0.7.8 `routeForMode` body. No mode
 * function mutates `balances`, so `routeForMode`'s two-pass eligibility
 * gate (below) works by substituting which `balances`/`config` object this
 * receives, never by editing any of the three mode functions themselves.
 */
function dispatchOnce(
  targetWithdrawal: number,
  config: ResolvedDecumulationConfig,
  balances: AccountBalances,
  bracketInfo: RouteBracketInfo,
): RouteResult {
  if (config.withdrawalRoutingMode === "bracket_filling") {
    return routeWithdrawalsBracketFilling(targetWithdrawal, config, balances, {
      taxBrackets: bracketInfo.taxBrackets,
      rothBracketTarget: bracketInfo.rothBracketTarget,
      taxableSS: bracketInfo.taxableSS,
    });
  }
  if (config.withdrawalRoutingMode === "percentage") {
    return routeWithdrawalsPercentage(targetWithdrawal, config, balances);
  }
  // Waterfall mode — apply Roth bracket optimization overlay if configured.
  const routeConfig = applyRothBracketOverlay(config, bracketInfo);
  return routeWithdrawals(targetWithdrawal, routeConfig, balances);
}

/**
 * Route a withdrawal using whichever mode config.withdrawalRoutingMode
 * selects — the single dispatch point both the real decumulation-year
 * execution and tax-gross-up.ts's estimate call, so a routing-mode-specific
 * rule (like the Roth-bracket overlay) can't be applied in one path and
 * forgotten in the other.
 *
 * `exposure` (v0.7.8 penalty-hard-exclusion follow-up,
 * DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md § Q2 — supersedes the
 * Tier B two-pass model this function used to implement) — when provided,
 * `config.avoidPenalizedWithdrawals` is on, and something is actually
 * penalty-exposed, dispatches ONCE against balances with every
 * penalty-exposed dollar subtracted out (`subtractPenaltyExposed`).
 * Penalty-exposed money is a hard exclusion now, not a last-resort
 * fallback: there is no second pass. A resulting `unmetNeed` is real —
 * `penaltyAvoidedShortfall` names how much of it is attributable
 * specifically to the exclusion (see `RouteResult`'s docblock) rather than
 * the household being broke. Falls through to a single unchanged
 * `dispatchOnce` call whenever any of those conditions doesn't hold — that
 * fallthrough (not a separately maintained branch) is what keeps a
 * nothing-penalty-exposed household, or a household with
 * `avoidPenalizedWithdrawals: false`, byte-identical to pre-this-pass
 * output.
 */
export function routeForMode(
  targetWithdrawal: number,
  config: ResolvedDecumulationConfig,
  balances: AccountBalances,
  bracketInfo: RouteBracketInfo,
  exposure?: EligibilityRecord,
): RouteResult {
  if (
    exposure == null ||
    exposure.totalPenaltyExposed === 0 ||
    !config.avoidPenalizedWithdrawals
  ) {
    return dispatchOnce(targetWithdrawal, config, balances, bracketInfo);
  }

  const penaltyFreeBalances = subtractPenaltyExposed(balances, exposure);
  const result = dispatchOnce(
    targetWithdrawal,
    config,
    penaltyFreeBalances,
    bracketInfo,
  );
  if (result.unmetNeed == null || result.unmetNeed <= 0) return result;
  const penaltyAvoidedShortfall = roundToCents(
    Math.min(result.unmetNeed, exposure.totalPenaltyExposed),
  );
  return { ...result, penaltyAvoidedShortfall };
}
