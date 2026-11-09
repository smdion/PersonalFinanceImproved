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
} from "../../../config/account-balance";
import { rankWithdrawalTiers } from "../withdrawal-cost-ranking";
import type { WithdrawalSourceKind } from "../withdrawal-cost-ranking";
import { routeWithdrawals } from "./waterfall";
import { computeBracketTraditionalCap, pastTargetWarning } from "./caps";
import type { RouteBracketInfo, RouteResult } from "./types";

/**
 * Route withdrawals using bracket-filling strategy.
 *
 * Instead of draining accounts sequentially (waterfall) or splitting by fixed %
 * (percentage), this mode optimizes tax efficiency each year:
 *
 * 1. Fill traditional withdrawals (401k/403b/IRA traditional) up to a tax
 *    bracket cap, in the household's own configured account order
 *    (see `phase1Order` below). This uses the
 *    cheap bracket space without overfilling into expensive brackets.
 * 2-4. Rank the remainder (Roth growth, brokerage LTCG, HSA) by real
 *    marginal cost each year instead of a fixed order
 *    (`withdrawal-cost-ranking.ts`'s `rankWithdrawalTiers`).
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

  // Computed ONCE, shared by Phase 1 (below) and `drawRothTierCapped`
  // further down, so both read "which Traditional-preference account
  // first" from the user's own `config.withdrawalOrder`, as waterfall and
  // percentage modes do. Filtering the user's FULL order down to just the
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

  // --- Phases 2-4: cost-ranked sources ---
  // Roth, brokerage, and HSA don't drain in a fixed order — a
  // non-qualified Roth growth withdrawal is real ordinary-rate income,
  // so draining it before brokerage sitting in the real 0%/15%
  // LTCG zone can pick the more expensive source purely from sequencing.
  // rankWithdrawalTiers (withdrawal-cost-ranking.ts) orders the remaining
  // need by actual marginal cost instead; this loop just mechanically
  // drains whatever order it returns, reusing the same per-category
  // draw/cap/merge logic each source always used.

  function drawRothTierCapped(cap: number): void {
    let tierRemaining = Math.min(remaining, cap);
    // Same `phase1Order` as Phase 1 above — Roth
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

  // Self-referential fixed point: the LTCG-room
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
  // The target bracket is a preference for the order money comes out in,
  // not a limit on spending: once Roth, brokerage and HSA can't cover the
  // rest, Traditional money pays it at a higher bracket rather than the
  // need going unmet while Traditional balances sit untouched. The user's
  // own per-account and Traditional caps still hold, and the year says so.
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
