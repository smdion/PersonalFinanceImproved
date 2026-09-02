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
import { marginalRateAtIncome } from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";
import {
  ltcgRoomForRate,
  ltcgRateForNextDollar,
  toLtcgTaxableIncome,
} from "../../config/tax-tables";
import {
  isRetirementParent,
  isTaxFreeBucket,
} from "../../config/account-types";
import { NIIT_RATE, NIIT_THRESHOLDS } from "../../config/niit";
import type { RothBasisState } from "@/lib/pure/roth-basis-tracking";
import type { IndKeyFn } from "@/lib/pure/withdrawal-eligibility";

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
  /** Advisor review, 2026-08-29 (finding #7): `indBasis`'s basis totals are
   *  tracked per Roth ACCOUNT, but a Portfolio-parented account is
   *  unconditionally excluded from the routable pool (R49 --
   *  `computeNonRetirementExclusion`, no config lever, no opt-out). Without
   *  `indAccts`/`indKey` here, a household whose Roth basis happens to sit
   *  in a Portfolio-parented account would still count it as "free"
   *  capacity in a pool that structurally can never draw from that
   *  account -- Tier-0's `Math.min(rothBasisAvailable, rothAvailable)`
   *  clamp bounds the TOTAL dollar amount correctly, but not which
   *  specific dollars are basis vs. growth, so pricing/ordering could
   *  still be wrong even though the total never overshoots. Passing these
   *  two (already in scope at both call sites, no new plumbing) lets this
   *  function drop a Portfolio-parented account's basis from the total
   *  instead of assuming every dollar of basis is reachable.
   *
   *  Deliberately NOT also filtering by penalty-exposure eligibility here:
   *  that exclusion is conditional on `config.avoidPenalizedWithdrawals`,
   *  which isn't available at either call site, and threading it through
   *  for this ordering-only refinement isn't worth the added risk --
   *  same category of scope boundary as the module docblock's "does not
   *  model IRMAA." */
  indAccts?: {
    name: string;
    category: string;
    taxType: string;
    ownerPersonId?: number;
    parentCategory?: string;
  }[];
  indKey?: IndKeyFn;
}): { rothBasisAvailable: number | undefined; brokerageBasisRatio: number } {
  const { balances, indBasis, indAccts, indKey } = params;
  let rothBasisAvailable: number | undefined;
  if (indBasis) {
    if (indAccts && indKey) {
      rothBasisAvailable = indAccts.reduce((s, ia) => {
        if (!isTaxFreeBucket(ia.taxType)) return s;
        if (!isRetirementParent(ia.parentCategory ?? "Retirement")) return s;
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
  /** Household's annual standard deduction — converts `ordinaryIncomeFloor`
   *  (gross) into real taxable income before it's compared against LTCG
   *  bracket thresholds. See `toLtcgTaxableIncome`'s docblock. Undefined ⇒
   *  0, i.e. the pre-fix behavior. */
  standardDeduction?: number;
  /** Which of Tier 0 (Roth basis) / Tier 1 (brokerage's 0%-LTCG room)
   *  drains first — both are free, so this is a draw-ORDER choice between
   *  two zero-cost tiers, not a pricing change. Verified against the
   *  user's own withdrawal-priority spreadsheet: brokerage's withdrawal
   *  there is capped at exactly `topOf0PercentLtcg - (traditionalWithdrawal
   *  - standardDeduction)` — i.e. the free 0%-LTCG room and nothing more —
   *  with Roth absorbing everything beyond that cap. So this toggle
   *  affects ONLY the free/free tie-break; the cost-ranked tier below
   *  (Roth growth vs. brokerage's real LTCG+NIIT rate vs. HSA) is
   *  unaffected either way — brokerage beyond the 0% zone is genuinely not
   *  "free," and unconditionally preferring it there was tried and
   *  reverted (it would draw a real 15%/20%+NIIT-cost brokerage dollar
   *  ahead of a cheaper Roth growth dollar). "roth_first" (default,
   *  undefined ⇒ this) matches all pre-existing behavior. "brokerage_first"
   *  is an explicit household opt-in — a brokerage LTCG gain still counts
   *  toward MAGI for ACA/IRMAA even at 0% federal tax, so this is a real,
   *  user-accepted tradeoff, not an automatic optimization. */
  discretionaryWithdrawalOrder?: "roth_first" | "brokerage_first";
}

/**
 * `rankWithdrawalTiers`'s full return value — the draw-ordered `tiers` plus
 * the two zero-cost tiers' capacities computed BEFORE
 * `discretionaryWithdrawalOrder` decides which goes first (and before
 * either is actually drawn from). Exists so callers can show "how much free
 * room existed" even in years where one tier's capacity was never reached
 * by the draw loop — e.g. Roth basis alone covered the year's need, so
 * brokerage's very real 0%-LTCG capacity was never touched, but is still a
 * real number worth surfacing (found live, 2026-08-31 — a household
 * couldn't tell why brokerage wasn't draining when their Traditional
 * bracket target was crowding out the 0%-LTCG room; this is what let them
 * see it). Both capacities are 0, not omitted, when there is none — so
 * callers can state "$0 room" rather than "no data."
 */
export type RankedWithdrawalTiers = {
  tiers: WithdrawalTier[];
  /** Roth basis capacity — always tax-free, independent of bracket. */
  rothBasisCapacity: number;
  /** Brokerage's 0%-LTCG-bracket capacity, in WITHDRAWAL dollars (already
   *  adjusted for `brokerageBasisRatio` — a $1 gain requires drawing more
   *  than $1 when part of the withdrawal is basis). NOT the same number as
   *  the underlying gains-room itself — see the module's callers for why
   *  this distinction matters when describing it in words. 0 when there is
   *  no filing status to look up a real LTCG bracket against (see the
   *  early-return branch below). */
  brokerageZeroLtcgCapacity: number;
};

/**
 * Rank the post-Traditional-cap sources cheapest-first. `tiers` is in draw
 * order; each tier's `capacity` is already clamped to that source's
 * available balance for the SLICE priced at that tier's rate (e.g. a
 * brokerage tier's capacity is expressed in withdrawal dollars, already
 * adjusted for `brokerageBasisRatio` — see inline comments).
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
    // No filing status ⇒ no real LTCG bracket lookup, no NIIT MAGI
    // threshold lookup (both are keyed by filing status) — brokerage
    // degrades to today's fixed flat-fallback pricing. Roth growth and HSA
    // (once it reaches this ranking it's ordinarily already the penalty-
    // free/penalty-excluded portion — see the design decision #8 note
    // below) both stack as plain ordinary income on the same floor.
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
    // No LTCG data here at all, so there's no brokerage-0%-tier
    // counterpart to reorder Roth basis against — `discretionaryWithdrawalOrder`
    // has nothing to act on and this always matches the pre-existing
    // fixed order (roth, then hsa, then brokerage's unpriced flat-fallback
    // tier last).
    return {
      tiers: [...rothTiers, ...(hsaTier ? [hsaTier] : []), ...brokerageTiers],
      rothBasisCapacity,
      brokerageZeroLtcgCapacity: 0,
    };
  }

  // Brokerage 0%-LTCG-zone capacity — free, like Roth basis. Convert
  // gains-room to withdrawal-room via the basis ratio (a $1 gain requires
  // drawing more than $1 when part of the withdrawal is basis).
  // `ordinaryIncomeFloor` is GROSS (correct for `rothGrowthRate` below,
  // against the ordinary W-4 brackets) — LTCG brackets are real
  // taxable-income thresholds, so this specific lookup needs the
  // household's standard deduction subtracted first. See
  // `toLtcgTaxableIncome`'s docblock.
  const zeroGainsRoom = ltcgRoomForRate(
    0,
    toLtcgTaxableIncome(ordinaryIncomeFloor, standardDeduction),
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
  const brokerageZeroTier: WithdrawalTier | undefined =
    brokerageZeroCapacity > 0
      ? { source: "brokerage", costRate: 0, capacity: brokerageZeroCapacity }
      : undefined;
  const brokerageRemaining = Math.max(
    0,
    brokerageAvailable - brokerageZeroCapacity,
  );

  // Roth growth / brokerage real-rate / HSA — priced by actual cost.
  //
  // Roth/HSA rate: priced off `ordinaryIncomeFloor` itself (the bracket
  // this household's income ACTUALLY sits in), not `marginalRateAboveTarget
  // (targetRate, ...)` (the bracket immediately above the Phase-1 BRACKET-
  // FILLING TARGET). Those coincide only when Phase 1 actually filled
  // Traditional up to that target — routing also reaches this ranking
  // when Traditional simply ran out below the target, where the target
  // rate overstates the household's real marginal bracket and
  // systematically overprices Roth/HSA withdrawals, biasing toward
  // brokerage even when brokerage is the more expensive source.
  const rothGrowthRate = marginalRateAtIncome(
    ordinaryIncomeFloor,
    taxBrackets,
    standardDeduction,
  );
  // HSA, once its balance reaches this ranking, is ordinarily already the
  // penalty-free/penalty-excluded portion (routeForMode's caller runs the
  // penalty exclusion BEFORE this ranking ever sees `hsaAvailable` — see
  // withdrawal-eligibility.ts's `computeHsaAccess`/`subtractExcluded`) —
  // so it stacks as plain ordinary income on the SAME floor as Roth
  // growth, not the "ordinary rate + 20% penalty, always worst" figure
  // design decision #8 originally assumed for every household regardless
  // of age. A household that explicitly opted OUT of penalty avoidance
  // and still has genuinely penalty-exposed HSA money reaching this
  // ranking gets a sub-optimal (not incorrect — the real penalty is still
  // priced correctly downstream by computeEarlyWithdrawalPenalty
  // regardless of draw order) tier position in that narrower, opted-in
  // case.
  const hsaRate = rothGrowthRate;

  // gains don't raise the ordinary floor itself — same taxable-income
  // conversion as zeroGainsRoom above, or this mixes a taxable-denominated
  // room with a gross-denominated floor.
  const brokerageOrdinaryIncome = toLtcgTaxableIncome(
    ordinaryIncomeFloor,
    standardDeduction,
  );
  // `brokerageOrdinaryIncome + zeroGainsRoom` always lands exactly on the
  // 0% bracket's own ceiling by construction (zeroGainsRoom IS that
  // ceiling minus brokerageOrdinaryIncome) — `getLtcgRate`'s inclusive
  // `<=` would answer "what's the rate for a real dollar sitting AT the
  // ceiling" (0%), not "what's the rate for the tier starting past it"
  // (found 2026-08-31, mispriced brokerage as free/NIIT-only well beyond
  // its real rate). Use the exclusive next-dollar lookup instead — see
  // its docblock for why this isn't just `getLtcgRate` with the numbers
  // shuffled.
  const ltcgRate = ltcgRateForNextDollar(
    brokerageOrdinaryIncome + zeroGainsRoom,
    filingStatus,
    ltcgBrackets,
  );
  // NIIT split (advisor review, 2026-08-29): NIIT is 3.8% on the LESSER of
  // net investment income or MAGI-over-threshold — a marginal boundary,
  // not an all-or-nothing cliff on the whole tier. Split brokerage's
  // remaining capacity at the point this tier's OWN gains would cross the
  // threshold, so the pre-threshold slice prices at the real 0%-NIIT rate
  // and only the post-threshold slice carries the +3.8% — a household
  // just under the threshold no longer gets 0% NIIT priced on a draw that
  // itself pushes them over, and one just over no longer gets 3.8% priced
  // on the whole tier including the portion that was under.
  const niitThreshold = NIIT_THRESHOLDS[filingStatus];
  // `magiBeforeThisDraw` is measured before ANY tier in this ranking
  // draws — it doesn't yet reflect the 0%-LTCG brokerage tier
  // (brokerageZeroCapacity, above), which is ranked and drawn ahead of
  // this NIIT-split tier in the same discretionary sequence. Only the
  // GAINS portion of that draw raises MAGI (a $1 gain contributes $1 to
  // MAGI regardless of its 0% federal LTCG rate — the basis portion
  // doesn't), so net that out before computing how much NIIT-threshold
  // room is left for the tier that runs next (advisor-flagged 2026-09-01:
  // without this, brokeragePreNiitCapacity is systematically overstated,
  // and some dollars get ranked at the bare ltcgRate when their real
  // marginal cost — once the zero tier's own gains are accounted for — is
  // ltcgRate + NIIT). Ordering-only: computeNiit prices the real charge
  // downstream regardless, so no dollar is mispriced in the final output.
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
        }
      : undefined;
  const hsaTier: WithdrawalTier | undefined =
    hsaAvailable > 0
      ? { source: "hsa", costRate: hsaRate, capacity: hsaAvailable }
      : undefined;

  // Tier 2: rank {Roth growth}, {brokerage at its real LTCG+NIIT rate},
  // and {HSA} by actual cost — unaffected by `discretionaryWithdrawalOrder`
  // either way (see this field's docblock: verified against the user's own
  // spreadsheet that brokerage beyond the free 0%-LTCG zone is genuinely
  // priced, not "chosen" unconditionally — advisor review, 2026-08-29,
  // also replacing what was a Roth-vs-brokerage-only 2-way comparison with
  // HSA hardcoded last regardless of cost).
  const priced = [
    rothGrowthTier,
    brokeragePreNiitTier,
    brokeragePostNiitTier,
    hsaTier,
  ]
    .filter((t): t is WithdrawalTier => t != null)
    // Stable sort (guaranteed by the spec since ES2019) — ties keep their
    // filter order above (roth, brokerage-pre-NIIT, brokerage-post-NIIT,
    // hsa), preserving decision #4's Roth-favored tie-break.
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
