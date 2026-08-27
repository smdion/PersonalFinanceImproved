/**
 * Cost-aware source ranking for withdrawal dollars beyond the Traditional
 * bracket cap (v0.7.9 R40 follow-up — see
 * `.scratch/docs/plans/DESIGN-DECISION-v0.7.9-cost-aware-routing.md`).
 *
 * `routeWithdrawalsBracketFilling`'s Phase 1 fills Traditional up to a
 * target ordinary-income bracket. Historically Phases 2-4 then drained
 * Roth, then brokerage, then HSA in a FIXED order regardless of actual
 * cost. That was harmless while Roth withdrawals were flat-0% tax; as of
 * v0.7.8, a non-qualified Roth growth withdrawal is real ordinary-rate
 * income, so the fixed order can pick the more expensive of two sources
 * purely because of sequencing — e.g. draining Roth growth at 22% in a
 * year brokerage sits in the real, bracket-based 0% LTCG zone.
 *
 * This module ranks the remaining-need sources by actual marginal cost —
 * Roth basis (free) and brokerage-in-0%-LTCG-room (free) first, then
 * whichever of {Roth growth at the ordinary rate above the bracket cap} or
 * {brokerage in the 15%/20% LTCG tier, plus NIIT above its MAGI threshold}
 * is genuinely cheaper, then HSA last (its ordinary-rate + 20%-penalty cost
 * is realistically always worst, unchanged from today).
 *
 * Single-year, need-driven only — does not model IRMAA, does not look
 * ahead to future brackets/RMDs (that's the roadmap's explicitly separate
 * "Version B"). Basis/growth splits it depends on collapse to today's
 * fixed order automatically when individual-account tracking isn't
 * enabled — see `rothBasisAvailable`'s docblock below.
 */
import type { FilingStatusType, TaxBuckets } from "../types";
import { marginalRateAboveTarget } from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";
import { ltcgRoomForRate, getLtcgRate } from "../../config/tax-tables";
import { NIIT_RATE, NIIT_THRESHOLDS } from "../../config/niit";
import type { RothBasisState } from "@/lib/pure/roth-basis-tracking";

export type WithdrawalSourceKind = "roth" | "brokerage" | "hsa";

/**
 * Derive `rothBasisAvailable`/`brokerageBasisRatio` from state both
 * `decumulation-year.ts`'s real execution and `tax-gross-up.ts`'s estimate
 * need to compute identically (RULES.md single-computation-path rule
 * applies across those two call sites the same way it applies within
 * `tax-gross-up.ts`'s own retries — see that file's header docblock).
 * `magiBeforeThisDraw` is deliberately NOT derived here — the real
 * execution has a precise `magiHistory` lookback available, the estimate
 * does not, and forcing them onto the same approximation would make the
 * estimate no more accurate while making the real path less accurate.
 */
export function deriveBasisRankingInputs(params: {
  balances: Pick<TaxBuckets, "afterTax" | "afterTaxBasis">;
  indBasis?: Map<string, RothBasisState>;
}): { rothBasisAvailable: number | undefined; brokerageBasisRatio: number } {
  const { balances, indBasis } = params;
  const rothBasisAvailable = indBasis
    ? Array.from(indBasis.values()).reduce(
        (s, state) => s + state.contributionBasis + state.conversionBasis,
        0,
      )
    : undefined;
  const brokerageBasisRatio =
    balances.afterTax > 0
      ? Math.min(1, balances.afterTaxBasis / balances.afterTax)
      : 0;
  return { rothBasisAvailable, brokerageBasisRatio };
}

export type WithdrawalTier = {
  source: WithdrawalSourceKind;
  /** Marginal cost rate for a dollar in this tier (0 = free). Informational
   *  — actual tax/penalty pricing is always `computeTaxFromSlots`'s job;
   *  this is what the ranking used to ORDER tiers, not a price to charge. */
  costRate: number;
  /** Max $ available in this tier at its stated cost before the next tier
   *  (or a rate change within the same source) takes over. `Infinity` when
   *  unbounded by a bracket/basis limit (the caller still clamps to actual
   *  account balances). */
  capacity: number;
};

export interface RankWithdrawalTiersInput {
  filingStatus: FilingStatusType | null | undefined;
  /** Ordinary taxable income already occupying the bracket stack BEFORE
   *  this ranking's own Roth-growth contribution — i.e.
   *  totalTraditionalWithdrawal + taxableSS + any conversion-reserved room
   *  (design decision #5). Used as the LTCG-stacking floor and to locate
   *  the marginal rate for Roth growth. */
  ordinaryIncomeFloor: number;
  /** The Phase-1 bracket target rate (`rothBracketTarget`) — Roth growth's
   *  marginal rate is the bracket immediately above this. */
  targetRate: number;
  taxBrackets: WithholdingBracket[];
  ltcgBrackets?: Record<string, { threshold: number | null; rate: number }[]>;
  /** Roth basis dollars available across the accounts routing will draw
   *  from, i.e. still-free withdrawal room BEFORE hitting non-qualified
   *  growth. When individual-account tracking isn't enabled there is no
   *  way to know this split — pass `rothAvailable` here too (treat the
   *  whole balance as basis), which reproduces today's "Roth is free"
   *  fixed-order behavior exactly, per design decision #4. */
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
}

/**
 * Rank the post-Traditional-cap sources cheapest-first. Returns tiers in
 * draw order; each tier's `capacity` is already clamped to that source's
 * available balance for the SLICE priced at that tier's rate (e.g. a
 * brokerage tier's capacity is expressed in withdrawal dollars, already
 * adjusted for `brokerageBasisRatio` — see inline comments).
 */
export function rankWithdrawalTiers(
  input: RankWithdrawalTiersInput,
): WithdrawalTier[] {
  const {
    filingStatus,
    ordinaryIncomeFloor,
    targetRate,
    taxBrackets,
    ltcgBrackets,
    rothBasisAvailable,
    rothAvailable,
    brokerageAvailable,
    brokerageBasisRatio,
    hsaAvailable,
    magiBeforeThisDraw,
  } = input;

  const tiers: WithdrawalTier[] = [];

  // Tier 0: Roth basis — always free, always first (ties with 0%-LTCG
  // brokerage broken in Roth's favor to match today's fixed order exactly
  // when there's nothing to gain by choosing otherwise — decision #4).
  const rothBasisCapacity = Math.max(
    0,
    Math.min(rothBasisAvailable, rothAvailable),
  );
  if (rothBasisCapacity > 0) {
    tiers.push({ source: "roth", costRate: 0, capacity: rothBasisCapacity });
  }

  const rothGrowthAvailable = Math.max(0, rothAvailable - rothBasisCapacity);

  if (!filingStatus) {
    // No filing status ⇒ no real LTCG bracket lookup, no NIIT MAGI
    // threshold lookup (both are keyed by filing status) — degrade to
    // today's fixed order: remaining Roth (now priced by the caller's flat
    // fallback rate, same as always), then brokerage, then HSA.
    if (rothGrowthAvailable > 0) {
      tiers.push({
        source: "roth",
        costRate: marginalRateAboveTarget(targetRate, taxBrackets),
        capacity: rothGrowthAvailable,
      });
    }
    if (brokerageAvailable > 0) {
      tiers.push({
        source: "brokerage",
        costRate: Infinity, // priced by caller's flat fallback, not this module
        capacity: brokerageAvailable,
      });
    }
    if (hsaAvailable > 0) {
      tiers.push({ source: "hsa", costRate: Infinity, capacity: hsaAvailable });
    }
    return tiers;
  }

  // Tier 1: brokerage gains in the 0% LTCG zone — free, like Roth basis.
  // Convert gains-room to withdrawal-room via the basis ratio (a $1 gain
  // requires drawing more than $1 when part of the withdrawal is basis).
  const zeroGainsRoom = ltcgRoomForRate(
    0,
    ordinaryIncomeFloor,
    filingStatus,
    ltcgBrackets,
  );
  const zeroWithdrawalRoom =
    brokerageBasisRatio < 1
      ? zeroGainsRoom / (1 - brokerageBasisRatio)
      : Infinity;
  const brokerageZeroCapacity = Math.max(
    0,
    Math.min(brokerageAvailable, zeroWithdrawalRoom),
  );
  if (brokerageZeroCapacity > 0) {
    tiers.push({
      source: "brokerage",
      costRate: 0,
      capacity: brokerageZeroCapacity,
    });
  }
  const brokerageRemaining = Math.max(
    0,
    brokerageAvailable - brokerageZeroCapacity,
  );

  // Tier 2: whichever of {Roth growth at ordinary rate} or {brokerage at
  // its real LTCG rate, plus NIIT above the MAGI threshold} is cheaper.
  const rothGrowthRate = marginalRateAboveTarget(targetRate, taxBrackets);

  const brokerageOrdinaryIncome = ordinaryIncomeFloor; // gains don't raise the ordinary floor itself
  const ltcgRate = getLtcgRate(
    brokerageOrdinaryIncome + zeroGainsRoom,
    filingStatus,
    ltcgBrackets,
  );
  const niitThreshold = NIIT_THRESHOLDS[filingStatus];
  const niitApplies = magiBeforeThisDraw > niitThreshold;
  const brokerageEffectiveRate = niitApplies ? ltcgRate + NIIT_RATE : ltcgRate;

  const cheaperIsRoth = rothGrowthRate <= brokerageEffectiveRate;
  const secondTierOrder: WithdrawalSourceKind[] = cheaperIsRoth
    ? ["roth", "brokerage"]
    : ["brokerage", "roth"];

  for (const source of secondTierOrder) {
    if (source === "roth" && rothGrowthAvailable > 0) {
      tiers.push({
        source: "roth",
        costRate: rothGrowthRate,
        capacity: rothGrowthAvailable,
      });
    }
    // `source` is a WithdrawalSourceKind, not an AccountCategory — coincides
    // with the string "brokerage" only. lint-violation-ok
    if (source === "brokerage" && brokerageRemaining > 0) {
      tiers.push({
        source: "brokerage",
        costRate: brokerageEffectiveRate,
        capacity: brokerageRemaining,
      });
    }
  }

  // Tier 3: HSA — last resort, unchanged (ordinary rate + 20% penalty is
  // realistically always worst; see design decision #8).
  if (hsaAvailable > 0) {
    tiers.push({ source: "hsa", costRate: Infinity, capacity: hsaAvailable });
  }

  return tiers;
}
