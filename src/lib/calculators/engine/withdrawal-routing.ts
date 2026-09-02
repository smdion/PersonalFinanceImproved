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
  FilingStatusType,
} from "../types";
import { roundToCents } from "../../utils/math";
import {
  getAllCategories,
  getAccountTypeConfig,
  isOverflowTarget,
  categoriesWithTaxPreference,
  tradPreferenceEngineCategories,
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
  getDefaultDecumulationOrder,
} from "../../config/account-types";
import { incomeCapForMarginalRate } from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";
import { subtractExcluded } from "./balance-utils";
import type {
  EligibilityRecord,
  NonRetirementExclusion,
} from "@/lib/pure/withdrawal-eligibility";
import { rankWithdrawalTiers } from "./withdrawal-cost-ranking";
import type { WithdrawalSourceKind } from "./withdrawal-cost-ranking";

const ACCOUNT_CATEGORIES: AccountCategory[] = getAllCategories();

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
 * 1. Fill traditional withdrawals (401k/403b/IRA traditional) up to a tax
 *    bracket cap, in the household's own configured account order (v0.7.10
 *    R51 Gap A — previously a hardcoded 401k→403b→IRA order regardless of
 *    what the user configured; see `phase1Order` below). This uses the
 *    cheap bracket space without overfilling into expensive brackets.
 * 2-4. Rank the remainder (Roth growth, brokerage LTCG, HSA) by real
 *    marginal cost each year instead of a fixed order (v0.7.9 R40 —
 *    `withdrawal-cost-ranking.ts`'s `rankWithdrawalTiers`; corrected this
 *    docblock, which still described the pre-R40 fixed Roth→brokerage→HSA
 *    order months after R40 shipped).
 *
 * The bracket cap is determined by `rothBracketTarget` (target marginal rate).
 * If no brackets or target are provided, falls back to waterfall behavior.
 */
export function routeWithdrawalsBracketFilling(
  targetWithdrawal: number,
  config: ResolvedDecumulationConfig,
  balances: AccountBalances,
  bracketInfo: RouteBracketInfo,
): Pick<
  RouteResult,
  | "slots"
  | "warnings"
  | "traditionalCap"
  | "unmetNeed"
  | "tierBreakdown"
  | "rothBasisCapacity"
  | "brokerageZeroLtcgCapacity"
> {
  const warnings: string[] = [];

  // If we don't have brackets or a target, fall back to waterfall
  if (
    !bracketInfo.taxBrackets ||
    bracketInfo.taxBrackets.length === 0 ||
    bracketInfo.rothBracketTarget == null
  ) {
    return routeWithdrawals(targetWithdrawal, config, balances);
  }

  // Traditional income cap: max traditional withdrawals before exceeding
  // the target marginal bracket, minus SS income already occupying that
  // bracket space. Shared with applyRothBracketOverlay below — see
  // computeBracketTraditionalCap's docblock.
  const traditionalCap = computeBracketTraditionalCap(bracketInfo);

  let remaining = targetWithdrawal;
  const slots: DecumulationSlot[] = [];
  let totalTradWithdrawn = 0;
  let totalRothWithdrawn = 0;
  // Track how much has been withdrawn from each category across phases
  const categoryWithdrawn = new Map<string, number>();

  const tradTypeCap = config.withdrawalTaxTypeCaps.traditional;
  const rothTypeCap = config.withdrawalTaxTypeCaps.roth;

  // Advisor review, 2026-08-29 (v0.7.10 R51 Gap A): computed ONCE, shared
  // by both Phase 1 (below) and `drawRothTierCapped` further down — both
  // loops need "which Traditional-preference account first," and a single
  // local here means the two can't drift the way they would if each
  // independently filtered `config.withdrawalOrder`. Previously both
  // loops ignored `config.withdrawalOrder` entirely and iterated
  // `categoriesWithTaxPreference()` directly (a config-declaration-order
  // list, not the user's own editable order) — waterfall and percentage
  // modes already honored the user's order; bracket_filling silently
  // didn't. Filtering the user's FULL order down to just the
  // Traditional-preference categories preserves their relative order
  // among themselves; `tradPreferenceEngineCategories()` (not
  // `categoriesWithTaxPreference()` alone) is the correct membership test
  // — see that function's docblock for why the two aren't guaranteed
  // identical by construction, even though they coincide today.
  const tradPreferenceCategories = new Set(tradPreferenceEngineCategories());
  const phase1Order = config.withdrawalOrder.filter((c) =>
    tradPreferenceCategories.has(c),
  );

  // --- Phase 1: Traditional from 401k/403b + IRA up to bracket cap ---
  for (const category of phase1Order) {
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

  // --- Phases 2-4: cost-ranked sources (v0.7.9 R40 follow-up) ---
  // Roth, brokerage, and HSA no longer drain in a fixed order — a
  // non-qualified Roth growth withdrawal is real ordinary-rate income
  // (v0.7.8), so draining it before brokerage sitting in the real 0%/15%
  // LTCG zone can pick the more expensive source purely from sequencing.
  // rankWithdrawalTiers (withdrawal-cost-ranking.ts) orders the remaining
  // need by actual marginal cost instead; this loop just mechanically
  // drains whatever order it returns, reusing the same per-category
  // draw/cap/merge logic each source always used.

  function drawRothTierCapped(cap: number): void {
    let tierRemaining = Math.min(remaining, cap);
    // Same `phase1Order` as Phase 1 above (v0.7.10 R51 Gap A) — Roth
    // withdrawals draw from the same physical accounts, so using a
    // different order here would let a household's configured order
    // apply to Traditional draws but not Roth draws in the same year.
    for (const category of phase1Order) {
      if (remaining <= 0 || tierRemaining <= 0) break;

      const accountCap = config.withdrawalAccountCaps[category];
      const catDrawn = categoryWithdrawn.get(category) ?? 0;
      const accountRoom =
        accountCap !== null ? Math.max(0, accountCap - catDrawn) : Infinity;
      const rothTypeRoom =
        rothTypeCap !== null
          ? Math.max(0, rothTypeCap - totalRothWithdrawn)
          : Infinity;

      const rothAvailable = Math.max(
        0,
        getRothBalance(balances[category]) -
          (categoryRothDrawn.get(category) ?? 0),
      );
      const rothDraw = roundToCents(
        Math.min(
          remaining,
          tierRemaining,
          rothAvailable,
          accountRoom,
          rothTypeRoom,
        ),
      );

      if (rothDraw > 0) {
        remaining = roundToCents(remaining - rothDraw);
        tierRemaining = roundToCents(tierRemaining - rothDraw);
        totalRothWithdrawn += rothDraw;
        categoryWithdrawn.set(category, catDrawn + rothDraw);
        categoryRothDrawn.set(
          category,
          (categoryRothDrawn.get(category) ?? 0) + rothDraw,
        );

        const existing = slots.find((s) => s.category === category);
        if (existing) {
          existing.rothWithdrawal = roundToCents(
            existing.rothWithdrawal + rothDraw,
          );
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
  }

  const overflowCats = ACCOUNT_CATEGORIES.filter(isOverflowTarget);
  function drawBrokerageTierCapped(cap: number): void {
    let tierRemaining = Math.min(remaining, cap);
    for (const brokCat of overflowCats) {
      if (remaining <= 0 || tierRemaining <= 0) break;
      const accountCap = config.withdrawalAccountCaps[brokCat];
      const alreadyDrawn = categoryWithdrawn.get(brokCat) ?? 0;
      const accountRoom =
        accountCap !== null ? Math.max(0, accountCap - alreadyDrawn) : Infinity;
      const available = Math.max(
        0,
        getTotalBalance(balances[brokCat]) - alreadyDrawn,
      );
      const draw = roundToCents(
        Math.min(remaining, tierRemaining, available, accountRoom),
      );
      if (draw > 0) {
        remaining = roundToCents(remaining - draw);
        tierRemaining = roundToCents(tierRemaining - draw);
        categoryWithdrawn.set(brokCat, alreadyDrawn + draw);
        const existing = slots.find((s) => s.category === brokCat);
        if (existing) {
          existing.withdrawal = roundToCents(existing.withdrawal + draw);
          existing.cappedByAccount =
            existing.cappedByAccount ||
            (accountCap !== null &&
              alreadyDrawn + draw >= (accountCap ?? Infinity));
          existing.remainingNeed = remaining > 0 ? remaining : 0;
        } else {
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
      }
    }
  }

  const singleBucketCats = ACCOUNT_CATEGORIES.filter(
    (cat) => getAccountTypeConfig(cat).balanceStructure === "single_bucket",
  );
  function drawHsaTierCapped(cap: number): void {
    let tierRemaining = Math.min(remaining, cap);
    for (const sbCat of singleBucketCats) {
      if (remaining <= 0 || tierRemaining <= 0) break;
      const accountCap = config.withdrawalAccountCaps[sbCat];
      const alreadyDrawn = categoryWithdrawn.get(sbCat) ?? 0;
      const accountRoom =
        accountCap !== null ? Math.max(0, accountCap - alreadyDrawn) : Infinity;
      const available = Math.max(
        0,
        getTotalBalance(balances[sbCat]) - alreadyDrawn,
      );
      const draw = roundToCents(
        Math.min(remaining, tierRemaining, available, accountRoom),
      );
      if (draw > 0) {
        remaining = roundToCents(remaining - draw);
        tierRemaining = roundToCents(tierRemaining - draw);
        categoryWithdrawn.set(sbCat, alreadyDrawn + draw);
        const existing = slots.find((s) => s.category === sbCat);
        if (existing) {
          existing.withdrawal = roundToCents(existing.withdrawal + draw);
          existing.traditionalWithdrawal = roundToCents(
            existing.traditionalWithdrawal + draw,
          );
          existing.remainingNeed = remaining > 0 ? remaining : 0;
        } else {
          slots.push({
            category: sbCat,
            withdrawal: draw,
            rothWithdrawal: 0,
            traditionalWithdrawal: draw, // Single-bucket = pre-tax for tax purposes
            cappedByAccount: accountCap !== null && draw >= accountRoom,
            cappedByTaxType: false,
            remainingNeed: remaining > 0 ? remaining : 0,
          });
        }
      }
    }
  }

  const categoryRothDrawn = new Map<string, number>();
  const rothAvailableTotal = categoriesWithTaxPreference().reduce(
    (s, cat) => s + getRothBalance(balances[cat]),
    0,
  );
  const brokerageAvailableTotal = overflowCats.reduce(
    (s, cat) => s + getTotalBalance(balances[cat]),
    0,
  );
  const hsaAvailableTotal = singleBucketCats.reduce(
    (s, cat) => s + getTotalBalance(balances[cat]),
    0,
  );

  // Self-referential fixed point (design decision #6): the LTCG-room
  // computation depends on ordinary income, which includes Roth growth —
  // itself an OUTPUT of this ranking. Re-rank up to 3 times, refining the
  // ordinary-income-floor estimate by the previous pass's implied Roth
  // growth draw, converging before drawing for real. Bounded like the
  // gross-up secant loop's own iteration cap, for the same reason: a real
  // tax system's cost curve doesn't move enough for more iterations to
  // matter, and unbounded iteration risks non-termination on pathological
  // inputs.
  // Reserve up to the rate the conversion will ACTUALLY target
  // (bracketInfo.conversionTarget), not necessarily the withdrawal
  // target's own traditionalCap above — they can differ (see
  // RouteBracketInfo.conversionTarget's docblock). Falls back to
  // traditionalCap itself when conversionTarget is omitted or equals
  // rothBracketTarget, so this is a no-op for every caller/fixture that
  // predates this field.
  const conversionCap =
    bracketInfo.conversionTarget != null &&
    bracketInfo.conversionTarget !== bracketInfo.rothBracketTarget
      ? computeBracketTraditionalCap({
          ...bracketInfo,
          rothBracketTarget: bracketInfo.conversionTarget,
        })
      : traditionalCap;
  const conversionReservedRoom = bracketInfo.conversionsEnabled
    ? Math.max(0, roundToCents(conversionCap - totalTradWithdrawn))
    : 0;
  const baseOrdinaryFloor =
    (bracketInfo.taxableSS ?? 0) + totalTradWithdrawn + conversionReservedRoom;
  // Hoisted (advisor review, 2026-08-29): this 9-field object used to be
  // written out twice (seed pass + every refine pass below), differing
  // only in `ordinaryIncomeFloor` — a field added to one copy and not the
  // other would silently change ranking behavior between the seed and
  // refine passes with nothing to catch it. One shared base, one field
  // that actually varies.
  const rankingBaseInput = {
    filingStatus: bracketInfo.filingStatus,
    taxBrackets: bracketInfo.taxBrackets ?? [],
    ltcgBrackets: bracketInfo.ltcgBrackets,
    rothBasisAvailable: bracketInfo.rothBasisAvailable ?? rothAvailableTotal,
    rothAvailable: rothAvailableTotal,
    brokerageAvailable: brokerageAvailableTotal,
    brokerageBasisRatio: bracketInfo.brokerageBasisRatio ?? 0,
    hsaAvailable: hsaAvailableTotal,
    magiBeforeThisDraw: bracketInfo.magiBeforeThisDraw ?? baseOrdinaryFloor,
    standardDeduction: bracketInfo.standardDeduction,
    discretionaryWithdrawalOrder: bracketInfo.discretionaryWithdrawalOrder,
  };
  let impliedRothGrowth = 0;
  let ranked = rankWithdrawalTiers({
    ...rankingBaseInput,
    ordinaryIncomeFloor: baseOrdinaryFloor,
  });
  for (let iter = 0; iter < 3; iter++) {
    let capacitySoFar = 0;
    let growthTierCapacity = 0;
    for (const tier of ranked.tiers) {
      if (tier.source === "roth" && tier.costRate > 0) {
        growthTierCapacity = Math.max(
          0,
          Math.min(remaining - capacitySoFar, tier.capacity),
        );
        break;
      }
      capacitySoFar += tier.capacity;
    }
    if (Math.abs(growthTierCapacity - impliedRothGrowth) < 1) break;
    impliedRothGrowth = growthTierCapacity;
    ranked = rankWithdrawalTiers({
      ...rankingBaseInput,
      ordinaryIncomeFloor: baseOrdinaryFloor + impliedRothGrowth,
    });
  }
  const tiers = ranked.tiers;

  const tierDrawers: Record<WithdrawalSourceKind, (cap: number) => void> = {
    roth: drawRothTierCapped,
    brokerage: drawBrokerageTierCapped,
    hsa: drawHsaTierCapped,
  };
  const tierBreakdown: NonNullable<RouteResult["tierBreakdown"]> = [];
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const before = remaining;
    tierDrawers[tier.source](tier.capacity);
    const drawn = roundToCents(before - remaining);
    if (drawn > 0) {
      tierBreakdown.push({
        source: tier.source,
        costRate: tier.costRate,
        amount: drawn,
      });
    }
  }

  // Ensure all 4 categories have slots (brokerage might be missing if not needed)
  // (advisor review, 2026-08-29: this ACCOUNT_CATEGORIES loop already
  // covers every singleBucketCats entry too, since singleBucketCats is a
  // subset — a separate identical loop over just that subset ran first
  // and was fully dead code, removed here.)
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
    tierBreakdown,
    rothBasisCapacity: ranked.rothBasisCapacity,
    brokerageZeroLtcgCapacity: ranked.brokerageZeroLtcgCapacity,
  };
}

// ---------------------------------------------------------------------------
// Mode dispatch — single entry point so real execution and tax-gross-up.ts's
// estimate can never route differently for the same inputs (Phase 5 item 5.3).
// ---------------------------------------------------------------------------

export interface RouteBracketInfo {
  taxBrackets?: WithholdingBracket[];
  rothBracketTarget?: number;
  /** The rate a same-year Roth conversion will actually target, when it
   *  differs from rothBracketTarget above (an explicit plan-level
   *  rothConversionTarget, or a per-year override — see
   *  decumulation-year.ts's resolvedConversionTarget). Falls back to
   *  rothBracketTarget when omitted, so existing callers that don't pass
   *  this (tax-gross-up.ts's estimate) keep prior behavior exactly.
   *  Advisor-caught 2026-09-01: conversionReservedRoom below used to
   *  reserve room up to rothBracketTarget's cap even when the conversion
   *  that actually runs targets a different, more specific rate — two
   *  names for one quantity, resolved by two different chains. */
  conversionTarget?: number;
  taxableSS: number;
  /** Below fields power v0.7.9 R40's cost-aware post-bracket-cap ranking
   *  (bracket_filling mode only — see `routeWithdrawalsBracketFilling`,
   *  `withdrawal-cost-ranking.ts`). All optional: omitted ⇒ the ranking
   *  degrades to the pre-v0.7.9 fixed Roth→brokerage→HSA order (no
   *  filingStatus at all skips LTCG/NIIT lookups entirely; the others
   *  default to "no basis tracking / no MAGI headroom known"). */
  filingStatus?: FilingStatusType | null;
  ltcgBrackets?: Record<string, { threshold: number | null; rate: number }[]>;
  /** Total Roth BASIS dollars (tax-free, non-qualified-growth-free) still
   *  available across the accounts routing will draw from, from
   *  individual-account tracking. Omitted (not 0!) ⇒ the ranking treats
   *  the WHOLE Roth balance as basis, matching today's "Roth is free"
   *  behavior exactly when individual tracking isn't enabled (design
   *  decision #4) — pass 0 explicitly only when tracking IS enabled and
   *  genuinely confirms no basis remains. */
  rothBasisAvailable?: number;
  /** `afterTaxBasis / afterTax` for brokerage, 0..1. Omitted/0 ⇒ every
   *  brokerage dollar is treated as a taxable gain (conservative). */
  brokerageBasisRatio?: number;
  /** MAGI before this year's gains/growth, for the NIIT headroom check.
   *  Omitted ⇒ NIIT check uses the ordinary-income floor as a MAGI proxy
   *  (slightly conservative when other MAGI add-ins exist). */
  magiBeforeThisDraw?: number;
  /** Whether this year's Roth conversion optimizer
   *  (`performRothConversion`, post-withdrawal-optimizer.ts) is enabled —
   *  when true, `routeWithdrawalsBracketFilling` reserves any Traditional
   *  bracket room Phase 1 left unused (`traditionalCap - totalTradWithdrawn`)
   *  from the LTCG-room floor, since the conversion is unconditional and
   *  will claim that same room later this same year — otherwise routing's
   *  LTCG-0% estimate assumes headroom the conversion is about to consume
   *  (design decision #5). Deliberately NOT a duplicate computation of
   *  `performRothConversion`'s own room formula: Phase 1 already fills
   *  Traditional up to the identical `rothBracketTarget` cap using the
   *  identical balance data, so `traditionalCap - totalTradWithdrawn` IS
   *  that same "unused room" quantity, not an approximation of it. */
  conversionsEnabled?: boolean;
  /** Household's annual standard deduction — converts the gross ordinary-
   *  income floor into real taxable income before LTCG bracket lookups.
   *  Omitted ⇒ 0 (pre-2026-08-30 behavior: LTCG room systematically
   *  understated, real LTCG tax overcharged). See `toLtcgTaxableIncome`. */
  standardDeduction?: number;
  /** R55 follow-up — see `RankWithdrawalTiersInput`'s field of the same
   *  name (`withdrawal-cost-ranking.ts`) for the full explanation.
   *  Undefined ⇒ "roth_first", matching all pre-existing behavior. */
  discretionaryWithdrawalOrder?: "roth_first" | "brokerage_first";
}

/**
 * The dollar cap on Traditional withdrawals/conversions that keeps ordinary
 * income within `bracketInfo.rothBracketTarget`'s bracket — the gross-income
 * ceiling for that bracket (after standard deduction) minus SS income
 * already occupying part of that room. Shared by
 * `routeWithdrawalsBracketFilling` and `applyRothBracketOverlay`
 * (advisor-caught 2026-09-01: these computed the byte-identical formula
 * independently under different variable names — same risk class as any
 * other duplicated computation, RULES.md single-computation-path).
 * Returns Infinity when there's no bracket data or target to compute from —
 * callers already branch on that case, this just makes "no cap" explicit
 * rather than requiring each caller to re-check `taxBrackets`/
 * `rothBracketTarget` before calling.
 */
export function computeBracketTraditionalCap(
  bracketInfo: RouteBracketInfo,
): number {
  if (
    !bracketInfo.taxBrackets ||
    bracketInfo.taxBrackets.length === 0 ||
    bracketInfo.rothBracketTarget == null
  ) {
    return Infinity;
  }
  const incomeCap = incomeCapForMarginalRate(
    bracketInfo.rothBracketTarget,
    bracketInfo.taxBrackets,
    bracketInfo.standardDeduction,
  );
  return roundToCents(Math.max(0, incomeCap - bracketInfo.taxableSS));
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
  /** Portion of `unmetNeed` attributable specifically to excluding
   *  Portfolio-parented ("non-retirement") money (R49). Same shape and
   *  same reasoning as `penaltyAvoidedShortfall` — a household can be
   *  short for this reason, the penalty-exclusion reason, both, or neither,
   *  and conflating any of them with plain "the household is broke" would
   *  destroy the distinction this field exists to preserve.
   *  `min(unmetNeed, nonRetirement.grandTotal)`. */
  nonRetirementShortfall?: number;
  /** How the discretionary need beyond Traditional's bracket-fill target
   *  was actually sourced, in draw order, at each tier's real cost —
   *  bracket_filling mode only (waterfall/percentage never rank by cost,
   *  so this is always empty there). Powers the "why was this account
   *  used" UI explanation: reads directly off `rankWithdrawalTiers`'
   *  own tiers (`withdrawal-cost-ranking.ts`) rather than re-deriving the
   *  reasoning from the resulting dollar amounts, so the explanation can
   *  never drift from what routing actually decided (RULES.md
   *  single-computation-path). Only tiers that were actually drawn from
   *  (amount > 0) are included. */
  tierBreakdown?: {
    source: WithdrawalSourceKind;
    costRate: number;
    amount: number;
  }[];
  /** The two zero-cost discretionary tiers' real capacity this year,
   *  computed BEFORE `discretionaryWithdrawalOrder` decides which drains
   *  first and before either is actually drawn from — so a tier that had
   *  real room but was never reached by the draw loop (e.g. Roth basis
   *  alone covered the year's need) still has its capacity visible, not
   *  silently discarded like `tierBreakdown` would. Passthrough of
   *  `rankWithdrawalTiers`' own return value (`withdrawal-cost-ranking.ts`)
   *  — see `RankedWithdrawalTiers`'s docblock for why this exists. Both are
   *  0 (bracket_filling mode with a resolvable bracket cap), not present,
   *  in waterfall/percentage modes — same scoping as `tierBreakdown`. */
  rothBasisCapacity?: number;
  brokerageZeroLtcgCapacity?: number;
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
  const rothOptTraditionalCap = computeBracketTraditionalCap(bracketInfo);
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
    // Advisor review, 2026-08-29 (v0.7.10 R51 Gap A round 2) — confirmed
    // load-bearing, NOT an oversight: this overlay adds a Traditional
    // tax-type cap above so the "Roth bracket optimization" this overlay
    // implements means anything in waterfall mode, `routeWithdrawals`'s
    // category loop still runs in the user's OWN configured order. If
    // that order puts a non-Traditional category (e.g. brokerage) ahead
    // of every Traditional-preference one, `remaining` gets consumed
    // before the cap ever binds, making the whole overlay a near-no-op —
    // confirmed against 3 real engine-snapshot fixtures that exercise
    // exactly this combination. Resetting to the default order guarantees
    // Traditional actually gets drawn first, which is the entire point of
    // this overlay. Do not remove without its own dedicated behavior-
    // change PR and tests, separate from any other withdrawalOrder fix.
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
    return routeWithdrawalsBracketFilling(
      targetWithdrawal,
      config,
      balances,
      bracketInfo,
    );
  }
  if (config.withdrawalRoutingMode === "percentage") {
    return routeWithdrawalsPercentage(targetWithdrawal, config, balances);
  }
  // Waterfall mode — apply Roth bracket optimization overlay if configured.
  const routeConfig = applyRothBracketOverlay(config, bracketInfo);
  const result = routeWithdrawals(targetWithdrawal, routeConfig, balances);
  // Surface the same bracket ceiling `routeWithdrawalsBracketFilling` reports
  // as `traditionalCap` (advisor-reviewed 2026-09-01, TODO.md) — previously
  // only bracket_filling mode populated this field, so waterfall + Roth-
  // bracket-overlay households never got a `bracketTraditionalCap` even
  // though the overlay was actively capping their withdrawals at exactly
  // this figure. `applyRothBracketOverlay` computes the identical
  // `computeBracketTraditionalCap(bracketInfo)` bracket_filling uses, AND
  // resets `withdrawalOrder` to force Traditional-first up to that cap
  // (see its own docblock) — the report narrative / table tooltip that cite
  // this figure describe the same real mechanism for waterfall as for
  // bracket_filling, so this is deliberately NOT mode-gated.
  // `routeConfig !== config` iff the overlay applied, which `applyRothBracketOverlay`
  // only does when this figure is finite — reusing that as the "did it apply" signal
  // instead of re-deriving the same null-check here.
  if (routeConfig !== config) {
    result.traditionalCap = computeBracketTraditionalCap(bracketInfo);
  }
  return result;
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
 * penalty-exposed, dispatches against balances with every penalty-exposed
 * dollar subtracted out. `nonRetirement` (R49 — see
 * `.scratch/docs/plans/PLAN-retirement-only-withdrawal-scope.md`) is the
 * same idea for Portfolio-parented ("not part of the retirement plan")
 * money — always excluded, no config lever, no opt-out. Both sources are
 * subtracted together in ONE dispatch (`subtractExcluded`) whenever either
 * has anything to exclude — there is no second pass for either. A
 * resulting `unmetNeed` is real — `penaltyAvoidedShortfall` and
 * `nonRetirementShortfall` each name how much of it is attributable to
 * their own exclusion (see `RouteResult`'s docblocks) rather than the
 * household being broke; a household can be short for either reason, both,
 * or neither. Falls through to a single unchanged `dispatchOnce` call
 * against the RAW balances whenever NEITHER source has anything to
 * exclude — that fallthrough (not a separately maintained branch) is what
 * keeps a household with nothing penalty-exposed AND nothing
 * Portfolio-parented (every household before R49; every existing test
 * fixture), or a household with `avoidPenalizedWithdrawals: false` and no
 * Portfolio-parented accounts, byte-identical to pre-R49 output.
 */
export function routeForMode(
  targetWithdrawal: number,
  config: ResolvedDecumulationConfig,
  balances: AccountBalances,
  bracketInfo: RouteBracketInfo,
  exposure?: EligibilityRecord,
  nonRetirement?: NonRetirementExclusion,
): RouteResult {
  const penaltyExclusionActive =
    exposure != null &&
    exposure.totalPenaltyExposedStillExcluded !== 0 &&
    config.avoidPenalizedWithdrawals;
  const nonRetirementExclusionActive =
    nonRetirement != null && nonRetirement.grandTotal !== 0;

  if (!penaltyExclusionActive && !nonRetirementExclusionActive) {
    return dispatchOnce(targetWithdrawal, config, balances, bracketInfo);
  }

  const excludedBalances = subtractExcluded(
    balances,
    penaltyExclusionActive ? exposure : undefined,
    nonRetirementExclusionActive ? nonRetirement : undefined,
  );
  const result = dispatchOnce(
    targetWithdrawal,
    config,
    excludedBalances,
    bracketInfo,
  );
  if (result.unmetNeed == null || result.unmetNeed <= 0) return result;
  // R41/R49: cap each against its own STILL-excluded/grand total, not a
  // blended figure — an allowed account's exposed dollars (R41) were never
  // excluded from this dispatch, and a real shortfall must never be
  // attributed to either source beyond what it actually excluded.
  const penaltyAvoidedShortfall = penaltyExclusionActive
    ? roundToCents(
        Math.min(result.unmetNeed, exposure.totalPenaltyExposedStillExcluded),
      )
    : undefined;
  const nonRetirementShortfall = nonRetirementExclusionActive
    ? roundToCents(Math.min(result.unmetNeed, nonRetirement.grandTotal))
    : undefined;
  return {
    ...result,
    ...(penaltyAvoidedShortfall != null ? { penaltyAvoidedShortfall } : {}),
    ...(nonRetirementShortfall != null ? { nonRetirementShortfall } : {}),
  };
}
