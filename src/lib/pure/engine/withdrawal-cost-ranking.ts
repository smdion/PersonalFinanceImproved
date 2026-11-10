/**
 * Ranks withdrawal sources beyond the Traditional bracket cap by marginal cost:
 * free tiers (Roth basis, brokerage 0%-LTCG room) first, then Roth growth vs priced
 * brokerage vs HSA. Single-year only: no IRMAA, no look-ahead to brackets or RMDs.
 */
import { isQualifiedRothOwner } from "@/lib/pure/tax/roth-distribution-tax";
import type { TaxBuckets } from "../accounts/account-balances.types";
import { marginalRateAtIncome } from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";
import {
  ltcgRoomForRate,
  ltcgRateForNextDollar,
  ltcgStackBase,
} from "@/lib/pure/tax/ltcg";
import { isRetirementMoney, isTaxFreeBucket } from "../../config/account-types";
import { NIIT_RATE, niitThresholdFor } from "../../config/niit";
import type { RothBasisState } from "@/lib/pure/accounts/roth-basis-tracking";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

export type WithdrawalSourceKind = "roth" | "brokerage" | "hsa";

/**
 * Derives `rothBasisAvailable`/`brokerageBasisRatio` once for both the real year
 * (decumulation-year.ts) and the solver's estimate, so they match (docs/RULES.md
 * single computation path). `magiBeforeThisDraw` is left to the router's floor.
 */
export function deriveBasisRankingInputs(params: {
  balances: Pick<TaxBuckets, "afterTax" | "afterTaxBasis">;
  /** Retirement brokerages' own basis ratio (brokerage-basis.ts), when
   *  basis is tracked per account; otherwise the aggregate ratio. */
  brokerageBasisRatio?: number;
  indBasis?: Map<string, RothBasisState>;
  /** With `indKey`, drops basis held in Portfolio-parented accounts, which routing
   *  never draws from. Penalty-exposed accounts are not filtered: that exclusion
   *  depends on `avoidPenalizedWithdrawals`, which neither call site has. */
  indAccounts?: {
    name: string;
    category: string;
    taxType: string;
    ownerPersonId?: number;
    ownerBirthYear?: number;
    parentCategory?: string;
  }[];
  indKey?: IndKeyFn;
  /** With both, a qualified owner's whole Roth balance is free capacity:
   *  growth past 59½ costs no more than basis does. */
  indBalance?: ReadonlyMap<string, number>;
  year?: number;
}): { rothBasisAvailable: number | undefined; brokerageBasisRatio: number } {
  const { balances, indBasis, indAccounts, indKey, indBalance, year } = params;
  let rothBasisAvailable: number | undefined;
  if (indBasis) {
    if (indAccounts && indKey) {
      rothBasisAvailable = indAccounts.reduce((s, ia) => {
        if (!isTaxFreeBucket(ia.taxType)) return s;
        if (!isRetirementMoney(ia.parentCategory)) return s;
        if (
          indBalance &&
          year !== undefined &&
          isQualifiedRothOwner(ia.ownerBirthYear, year)
        )
          return s + Math.max(0, indBalance.get(indKey(ia)) ?? 0);
        const state = indBasis.get(indKey(ia));
        return state ? s + state.contributionBasis + state.conversionBasis : s;
      }, 0);
    } else {
      rothBasisAvailable = Array.from(indBasis.values()).reduce(
        (s, state) => s + state.contributionBasis + state.conversionBasis,
        0,
      );
    }
  }
  const brokerageBasisRatio =
    params.brokerageBasisRatio ??
    (balances.afterTax > 0
      ? Math.min(1, balances.afterTaxBasis / balances.afterTax)
      : 0);
  return { rothBasisAvailable, brokerageBasisRatio };
}

export type WithdrawalTier = {
  source: WithdrawalSourceKind;
  /** Marginal cost rate for a dollar in this tier (0 = free). Informational
   *  — actual tax/penalty pricing is always `computeTaxFromSlots`'s job;
   *  this is what the ranking used to ORDER tiers, not a price to charge. */
  costRate: number;
  /** Max $ in this tier at its stated cost. `Infinity` when no bracket or basis
   *  limit bounds it (the caller still clamps to account balances). */
  capacity: number;
  /** Brokerage beyond the Medicare surtax threshold: `costRate` is the
   *  capital-gains rate plus NIIT. */
  includesNiit?: true;
};

export interface RankWithdrawalTiersInput {
  filingStatus: ReturnFilingStatus | null | undefined;
  /** Gross ordinary income already in the bracket stack (Traditional draws +
   *  taxable SS + conversion-reserved room): the LTCG-stacking floor and the
   *  point Roth growth's marginal rate is read at. */
  ordinaryIncomeFloor: number;
  taxBrackets: WithholdingBracket[];
  ltcgBrackets: Record<string, { threshold: number | null; rate: number }[]>;
  /** Free Roth room (basis) in the accounts routing draws from. Without
   *  individual-account tracking, pass `rothAvailable` (all basis), which
   *  gives the fixed "Roth is free" order. */
  rothBasisAvailable: number;
  /** Total Roth balance available to route from (basis + growth). */
  rothAvailable: number;
  brokerageAvailable: number;
  /** `afterTaxBasis / afterTax`, 0..1 — fraction of a brokerage withdrawal
   *  that's a tax-free return of basis rather than a taxable gain. */
  brokerageBasisRatio: number;
  hsaAvailable: number;
  /** MAGI before any gains/growth this ranking realizes — for the NIIT
   *  headroom check on the brokerage/Roth-growth tier. IRMAA is NOT
   *  modeled here (explicitly out of scope — see module docblock). */
  magiBeforeThisDraw: number;
  /** Household's annual standard deduction: converts `ordinaryIncomeFloor`
   *  (gross) to the taxable income LTCG brackets use (`ltcgStackBase`);
   *  undefined subtracts nothing. */
  standardDeduction?: number;
  /** Which free tier drains first: Roth basis or brokerage's 0%-LTCG room. Only
   *  the free/free tie-break; priced tiers stay cost-ranked. Undefined ⇒ roth_first;
   *  brokerage_first is an opt-in, since 0% LTCG gains still count toward MAGI. */
  discretionaryWithdrawalOrder?: "roth_first" | "brokerage_first";
}

/**
 * Draw-ordered `tiers` plus both free tiers' capacities before any draw, so
 * callers can show free room the year never reached. Capacities are 0, not
 * omitted, when there is none.
 */
type RankedWithdrawalTiers = {
  tiers: WithdrawalTier[];
  /** Roth basis capacity — always tax-free, independent of bracket. */
  rothBasisCapacity: number;
  /** Brokerage's 0%-LTCG capacity in withdrawal dollars (gains room scaled up by
   *  `brokerageBasisRatio`), not the gains room itself. 0 without a filing
   *  status. */
  brokerageZeroLtcgCapacity: number;
};

/**
 * Ranks the post-Traditional-cap sources cheapest-first, in draw order. Each
 * tier's `capacity` is clamped to its source's balance for the slice priced at
 * that rate (brokerage tiers in withdrawal dollars).
 */
export function rankWithdrawalTiers(
  input: RankWithdrawalTiersInput,
): RankedWithdrawalTiers {
  const {
    filingStatus,
    ordinaryIncomeFloor,
    taxBrackets,
    ltcgBrackets,
    rothBasisAvailable,
    rothAvailable,
    brokerageAvailable,
    brokerageBasisRatio,
    hsaAvailable,
    magiBeforeThisDraw,
    standardDeduction,
    discretionaryWithdrawalOrder,
  } = input;

  const brokerageFirst = discretionaryWithdrawalOrder === "brokerage_first";

  // Roth basis — free. Capacity only; NOT pushed into `tiers` yet, since
  // where it lands depends on `discretionaryWithdrawalOrder` (assembled at
  // the bottom of this function).
  const rothBasisCapacity = Math.max(
    0,
    Math.min(rothBasisAvailable, rothAvailable),
  );
  const rothBasisTier: WithdrawalTier | undefined =
    rothBasisCapacity > 0
      ? { source: "roth", costRate: 0, capacity: rothBasisCapacity }
      : undefined;
  const rothGrowthAvailable = Math.max(0, rothAvailable - rothBasisCapacity);

  if (!filingStatus) {
    // No filing status ⇒ no LTCG bracket or NIIT threshold (both keyed by it):
    // brokerage gets flat-fallback pricing. Roth growth and HSA (already
    // penalty-excluded here) stack as ordinary income on the same floor.
    const ordinaryRate = marginalRateAtIncome(
      ordinaryIncomeFloor,
      taxBrackets,
      standardDeduction,
    );
    const rothGrowthTier: WithdrawalTier | undefined =
      rothGrowthAvailable > 0
        ? {
            source: "roth",
            costRate: ordinaryRate,
            capacity: rothGrowthAvailable,
          }
        : undefined;
    const hsaTier: WithdrawalTier | undefined =
      hsaAvailable > 0
        ? { source: "hsa", costRate: ordinaryRate, capacity: hsaAvailable }
        : undefined;
    const brokerageTier: WithdrawalTier | undefined =
      brokerageAvailable > 0
        ? {
            source: "brokerage",
            costRate: Infinity, // priced by caller's flat fallback, not this module
            capacity: brokerageAvailable,
          }
        : undefined;
    const rothTiers = [rothBasisTier, rothGrowthTier].filter(
      (t): t is WithdrawalTier => t != null,
    );
    const brokerageTiers = [brokerageTier].filter(
      (t): t is WithdrawalTier => t != null,
    );
    // No brokerage 0% tier to reorder against, so `discretionaryWithdrawalOrder`
    // has nothing to act on: fixed order roth, hsa, then flat-fallback brokerage.
    return {
      tiers: [...rothTiers, ...(hsaTier ? [hsaTier] : []), ...brokerageTiers],
      rothBasisCapacity,
      brokerageZeroLtcgCapacity: 0,
    };
  }

  // Brokerage 0%-LTCG room is free: the deduction ordinary income leaves unused,
  // then the 0% band above the ordinary taxable income. Gains room converts to
  // withdrawal room via the basis ratio.
  const stackBase = ltcgStackBase(ordinaryIncomeFloor, standardDeduction);
  const zeroBandRoom = ltcgRoomForRate(
    0,
    stackBase.ordinaryTaxable,
    filingStatus,
    ltcgBrackets,
  );
  const zeroGainsRoom = stackBase.unusedDeduction + zeroBandRoom;
  const zeroWithdrawalRoom =
    brokerageBasisRatio < 1
      ? zeroGainsRoom / (1 - brokerageBasisRatio)
      : Infinity;
  const brokerageZeroCapacity = Math.max(
    0,
    Math.min(brokerageAvailable, zeroWithdrawalRoom),
  );
  const brokerageZeroTier: WithdrawalTier | undefined =
    brokerageZeroCapacity > 0
      ? { source: "brokerage", costRate: 0, capacity: brokerageZeroCapacity }
      : undefined;
  const brokerageRemaining = Math.max(
    0,
    brokerageAvailable - brokerageZeroCapacity,
  );

  // Roth/HSA price at the bracket income actually sits in, not the one above the
  // fill target: Traditional can run out below the target, and the target rate
  // would then overprice Roth/HSA against brokerage.
  const rothGrowthRate = marginalRateAtIncome(
    ordinaryIncomeFloor,
    taxBrackets,
    standardDeduction,
  );
  // HSA reaching this ranking is already penalty-excluded, so it prices like Roth
  // growth. With penalty avoidance off, exposed HSA may rank sub-optimally; the
  // penalty itself is still charged by computeEarlyWithdrawalPenalty.
  const hsaRate = rothGrowthRate;

  // `ordinaryTaxable + zeroBandRoom` sits exactly on the 0% ceiling, where
  // `getLtcgRate` (a dollar at the ceiling) says 0%. This tier starts past
  // it, so it's priced at the next dollar's rate.
  const ltcgRate = ltcgRateForNextDollar(
    stackBase.ordinaryTaxable + zeroBandRoom,
    filingStatus,
    ltcgBrackets,
  );
  // NIIT is 3.8% on the lesser of investment income or MAGI over the threshold,
  // so split brokerage's capacity where this tier's own gains cross it: only the
  // post-threshold slice carries the +3.8%.
  const niitThreshold = niitThresholdFor(filingStatus);
  // `magiBeforeThisDraw` predates the 0%-LTCG tier drawn ahead of this one; its
  // gains (not basis) raise MAGI, so net them out of the NIIT headroom. Ordering
  // only: computeNiit prices the real charge downstream.
  const zeroTierGainsPortion =
    brokerageZeroCapacity * (1 - brokerageBasisRatio);
  const magiHeadroomForNiit = Math.max(
    0,
    niitThreshold - magiBeforeThisDraw - zeroTierGainsPortion,
  );
  const preNiitWithdrawalRoom =
    brokerageBasisRatio < 1
      ? magiHeadroomForNiit / (1 - brokerageBasisRatio)
      : Infinity;
  const brokeragePreNiitCapacity = Math.max(
    0,
    Math.min(brokerageRemaining, preNiitWithdrawalRoom),
  );
  const brokeragePostNiitCapacity = Math.max(
    0,
    brokerageRemaining - brokeragePreNiitCapacity,
  );

  const rothGrowthTier: WithdrawalTier | undefined =
    rothGrowthAvailable > 0
      ? {
          source: "roth",
          costRate: rothGrowthRate,
          capacity: rothGrowthAvailable,
        }
      : undefined;
  const brokeragePreNiitTier: WithdrawalTier | undefined =
    brokeragePreNiitCapacity > 0
      ? {
          source: "brokerage",
          costRate: ltcgRate,
          capacity: brokeragePreNiitCapacity,
        }
      : undefined;
  const brokeragePostNiitTier: WithdrawalTier | undefined =
    brokeragePostNiitCapacity > 0
      ? {
          source: "brokerage",
          costRate: ltcgRate + NIIT_RATE,
          capacity: brokeragePostNiitCapacity,
          includesNiit: true,
        }
      : undefined;
  const hsaTier: WithdrawalTier | undefined =
    hsaAvailable > 0
      ? { source: "hsa", costRate: hsaRate, capacity: hsaAvailable }
      : undefined;

  // Tier 2: Roth growth, brokerage at its LTCG+NIIT rate and HSA, ranked by cost;
  // `discretionaryWithdrawalOrder` does not apply here.
  const priced = [
    rothGrowthTier,
    brokeragePreNiitTier,
    brokeragePostNiitTier,
    hsaTier,
  ]
    .filter((t): t is WithdrawalTier => t != null)
    // Stable sort (guaranteed by the spec since ES2019) — ties keep their
    // filter order above (roth, brokerage-pre-NIIT, brokerage-post-NIIT,
    // hsa), so a tie favors Roth.
    .sort((a, b) => a.costRate - b.costRate);

  // Tiers 0/1: both free — Roth basis and brokerage's 0%-LTCG room.
  // `discretionaryWithdrawalOrder` only controls which of these two goes
  // first; the priced tier above is unaffected.
  const tiers = brokerageFirst
    ? [
        ...(brokerageZeroTier ? [brokerageZeroTier] : []),
        ...(rothBasisTier ? [rothBasisTier] : []),
        ...priced,
      ]
    : [
        ...(rothBasisTier ? [rothBasisTier] : []),
        ...(brokerageZeroTier ? [brokerageZeroTier] : []),
        ...priced,
      ];

  return {
    tiers,
    rothBasisCapacity,
    brokerageZeroLtcgCapacity: brokerageZeroCapacity,
  };
}
