/** Bracket filling: Traditional to the target bracket, the rest by cost. */
import type { DecumulationSlot } from "../types/routing";
import type { ResolvedDecumulationConfig } from "../types/decumulation";
import type { AccountBalances } from "../../accounts/account-balances.types";
import { roundToCents } from "../../../utils/math";
import {
  getAllCategories,
  getAccountTypeConfig,
  isOverflowTarget,
  categoriesWithTaxPreference,
  tradPreferenceEngineCategories,
} from "../../../config/account-types";
import {
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
} from "../../accounts/account-balance";
import { rankWithdrawalTiers } from "../withdrawal-cost-ranking";
import type { WithdrawalSourceKind } from "../withdrawal-cost-ranking";
import { routeWithdrawalsWaterfall } from "./waterfall";
import { computeBracketTraditionalCap, pastTargetWarning } from "./caps";
import type { RouteBracketInfo, RouteResult } from "./types";

/**
 * Bracket-filling routing: fill Traditional up to the `rothBracketTarget` bracket
 * cap in the configured account order, then draw the rest by marginal cost
 * (`rankWithdrawalTiers`). Without brackets or a target, behaves as waterfall.
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
    return routeWithdrawalsWaterfall(targetWithdrawal, config, balances);
  }

  // Max Traditional withdrawals before exceeding the target bracket, net of SS
  // already in it; shared with applyRothBracketOverlay.
  const traditionalCap = computeBracketTraditionalCap(bracketInfo);

  let remaining = targetWithdrawal;
  const slots: DecumulationSlot[] = [];
  let totalTradWithdrawn = 0;
  let totalRothWithdrawn = 0;
  // Track how much has been withdrawn from each category across phases
  const categoryWithdrawn = new Map<string, number>();

  const tradTypeCap = config.withdrawalTaxTypeCaps.traditional;
  const rothTypeCap = config.withdrawalTaxTypeCaps.roth;

  // The user's `withdrawalOrder` filtered to Traditional-preference categories,
  // shared by Phase 1 and `drawRothTierCapped`. `tradPreferenceEngineCategories()`
  // is the membership test, not `categoriesWithTaxPreference()` (see its docblock).
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

  // --- Phases 2-4: cost-ranked sources ---
  // Roth growth is ordinary income, so a fixed order can pick the costlier source;
  // this drains the order rankWithdrawalTiers returns.

  function drawRothTierCapped(cap: number): void {
    let tierRemaining = Math.min(remaining, cap);
    // Same `phase1Order` as Phase 1: Roth draws come from the same accounts, so
    // the configured order must apply to both.
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

  const overflowCats = getAllCategories().filter(isOverflowTarget);
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

  const singleBucketCats = getAllCategories().filter(
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

  // Fixed point: LTCG room depends on ordinary income, which includes the Roth
  // growth this ranking outputs. Re-rank up to 3 times, refining the floor by the
  // previous pass's Roth growth draw; bounded to guarantee termination.

  // Reserve room up to the conversion's own target (`conversionTarget`), which can
  // differ from the withdrawal target; otherwise `traditionalCap`.
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
  // One base for the seed pass and every refine pass below; only
  // `ordinaryIncomeFloor` varies between them.
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
        ...(tier.includesNiit && { includesNiit: true as const }),
      });
    }
  }

  // --- Phase 5: Traditional above the bracket target ---
  // The target orders withdrawals, it doesn't limit spending: Traditional covers
  // what other sources can't, within the user's own caps, and the year says so.
  let pastTarget = 0;
  for (const category of phase1Order) {
    if (remaining <= 0) break;
    const accountCap = config.withdrawalAccountCaps[category];
    const catDrawn = categoryWithdrawn.get(category) ?? 0;
    const accountRoom =
      accountCap !== null ? Math.max(0, accountCap - catDrawn) : Infinity;
    const tradDrawnHere =
      slots.find((sl) => sl.category === category)?.traditionalWithdrawal ?? 0;
    const tradAvailable = Math.max(
      0,
      getTraditionalBalance(balances[category]) - tradDrawnHere,
    );
    const tradTypeRoom =
      tradTypeCap !== null
        ? Math.max(0, tradTypeCap - totalTradWithdrawn)
        : Infinity;
    const tradDraw = roundToCents(
      Math.min(remaining, tradAvailable, accountRoom, tradTypeRoom),
    );
    if (tradDraw <= 0) continue;
    pastTarget = roundToCents(pastTarget + tradDraw);
    remaining = roundToCents(remaining - tradDraw);
    totalTradWithdrawn += tradDraw;
    categoryWithdrawn.set(category, catDrawn + tradDraw);
    const existing = slots.find((sl) => sl.category === category);
    if (existing) {
      existing.traditionalWithdrawal = roundToCents(
        existing.traditionalWithdrawal + tradDraw,
      );
      existing.withdrawal = roundToCents(existing.withdrawal + tradDraw);
      existing.cappedByAccount =
        existing.cappedByAccount ||
        (accountCap !== null && tradDraw >= accountRoom);
      // Phase 1 marked the bracket target as this slot's cap; it didn't
      // hold. Only the user's own Roth/Traditional caps still can.
      existing.cappedByTaxType =
        (tradTypeCap !== null && tradDraw >= tradTypeRoom) ||
        (rothTypeCap !== null && totalRothWithdrawn >= rothTypeCap);
      existing.remainingNeed = remaining > 0 ? remaining : 0;
    } else {
      slots.push({
        category,
        withdrawal: tradDraw,
        rothWithdrawal: 0,
        traditionalWithdrawal: tradDraw,
        cappedByAccount: accountCap !== null && tradDraw >= accountRoom,
        cappedByTaxType: tradTypeCap !== null && tradDraw >= tradTypeRoom,
        remainingNeed: remaining > 0 ? remaining : 0,
      });
    }
  }

  if (pastTarget > 0) warnings.push(pastTargetWarning(pastTarget));

  // Every category gets a slot, including ones nothing was drawn from.
  for (const cat of getAllCategories()) {
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
