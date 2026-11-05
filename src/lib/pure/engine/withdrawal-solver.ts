/**
 * Withdrawal tax gross-up — the SS-torpedo convergence loop that resolves
 * decumulation-year.ts's circular dependency: the amount that needs to be
 * withdrawn depends on the tax cost of withdrawing it, and the tax cost
 * depends on the withdrawal amount.
 *
 * Lives in its own file (split out of tax-estimation.ts)
 * because it needs to call withdrawal-routing.ts's routeForMode — and
 * withdrawal-routing.ts itself imports incomeCapForMarginalRate from
 * tax-estimation.ts, so estimateWithdrawalTaxCost living in tax-estimation.ts
 * would create an import cycle. This file sits above both: it imports the
 * pure tax math from tax-estimation.ts and the real router from
 * withdrawal-routing.ts, and neither of those needs to import this file back.
 *
 * Before this split, the convergence loop hand-simulated bracket-filling and
 * waterfall routing separately from the real router — and had silently
 * drifted from it in three ways:
 *   1. Percentage mode estimated tax using portfolio-balance weights; the
 *      real router uses config.withdrawalSplits.
 *   2. Waterfall + a configured rothBracketTarget: the real router applies a
 *      Roth-bracket-optimization overlay to the config (forced traditional
 *      preference, adjusted caps) before routing; the estimate simulated the
 *      unmodified config.
 *   3. Bracket-filling ignored withdrawalAccountCaps, which the real router
 *      enforces per category.
 * Each produced a wrong grossUpFactor → wrong targetWithdrawal → wrong money
 * movement for real users in those configurations. Now both the estimate and
 * the real execution call the same routeForMode + computeTaxFromSlots, so
 * they cannot diverge on the routing or tax math — only on what's genuinely
 * unknowable pre-routing: RMD enforcement and Roth conversions, both of
 * which happen strictly after routing and are re-applied to taxCost/
 * grossUpFactor post-hoc in decumulation-year.ts (see its "post-RMD"
 * recompute). That residual gap is accepted, not fixed — RMD amount and
 * Roth-conversion elections are not knowable before routing.
 */
import type { ResolvedDecumulationConfig } from "./types/decumulation";
import type {
  AccountBalances,
  TaxBuckets,
  IndividualAccountInput,
} from "../types/shared";
import { computeNiit } from "../../config/niit";
import { yearMagi } from "@/lib/pure/tax/year-income";
import { roundToCents } from "../../utils/math";
import { cloneAccountBalances } from "./balance-utils";
import {
  taxableSSFor,
  computeTaxFromSlots,
  type WithholdingBracket,
} from "./tax-estimation";
import { routeForMode } from "./withdrawal-routing";
import { deriveBasisRankingInputs } from "./withdrawal-cost-ranking";
import type {
  EligibilityRecord,
  NonRetirementExclusion,
} from "@/lib/pure/accounts/eligibility";
import {
  distributeWithdrawals,
  depleteIndividualBasis,
} from "./individual-account-tracking";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { splitRothWithdrawalForTax } from "@/lib/pure/tax/roth-distribution-tax";
import type { RothBasisState } from "@/lib/pure/accounts/roth-basis-tracking";
import { computeEarlyWithdrawalPenalty } from "@/lib/pure/accounts/early-withdrawal-penalty";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

/** Input for the convergence estimation. */
interface TaxEstimationInput {
  /** After-tax spending need (expenses - SS income). Ignored when
   *  `fixedGrossWithdrawal` is set. */
  afterTaxNeed: number;
  /** A portfolio-sized strategy's amount with Social Security on top: the
   *  gross withdrawal is fixed (no solving), and the after-tax need it
   *  delivers is derived from it (`derivedAfterTaxNeed`). */
  fixedGrossWithdrawal?: number;
  /** Social Security income for this year */
  ssIncome: number;
  /** Social Security beyond this year's spending. It pays the year's tax
   *  first, so only the rest needs a withdrawal; never banked past that.
   *  Omitted or 0 in a `fixedGrossWithdrawal` year (Social Security is on
   *  top of the amount by definition). */
  ssSurplus?: number;
  /** Filing status for SS taxation thresholds */
  filingStatus: ReturnFilingStatus | null | undefined;
  /** Resolved decumulation config for this year */
  config: ResolvedDecumulationConfig;
  /** Tax rate configuration from decumulation defaults */
  taxRates: {
    grossUpForTaxes?: boolean;
    traditionalFallbackRate: number;
    roth: number;
    hsa: number;
    brokerage: number;
    taxBrackets?: WithholdingBracket[];
    rothBracketTarget?: number;
    /** See RouteBracketInfo.conversionTarget's docblock (withdrawal-routing.ts). */
    rothConversionTarget?: number;
    taxMultiplier?: number;
    ltcgBrackets: Record<string, { threshold: number | null; rate: number }[]>;
    enableRothConversions?: boolean;
    /** Household's annual standard deduction — see `RouteBracketInfo.standardDeduction`
     *  (withdrawal-routing.ts). Declared here (not just structurally passed
     *  through) so it's a documented contract, not a field the next reader
     *  could "clean up" by destructuring and dropping — this module's own
     *  header docblock is a record of exactly that failure mode happening
     *  before (the routing-divergence fixes). */
    standardDeduction?: number;
  };
  /** Current balances by tax bucket */
  balances: TaxBuckets;
  /** Current per-account balances */
  acctBal: AccountBalances;
  /** Every account's balance, Portfolio-parented ones included
   *  (PreYearSetup.totalBalance): the physical pool the target never
   *  exceeds. The search stops sooner, at what the router can reach (the
   *  router-exhaustion stop below), and routing records the rest as
   *  `nonRetirementShortfall`. */
  totalBalance: number;
  /** The year's brokerage basis ratio for retirement withdrawals
   *  (brokerage-basis.ts) — the same one the real execution prices with.
   *  Omitted: the aggregate ratio. */
  brokerageBasisRatio?: number;
  /** Withdrawal-ordering eligibility for this year — passed straight
   *  through to `routeForMode`. MUST be the
   *  same record `decumulation-year.ts`'s real execution passes to its own
   *  `routeForMode` call: the single-dispatch invariant this module's
   *  header docblock documents applies to this parameter too — a mismatch
   *  here would desync the withdrawal-solver estimate's slot mix from the real
   *  router's, the same class of bug the routeForMode extraction fixed for
   *  the routing-mode-specific rules. */
  eligibility?: EligibilityRecord;
  /** Portfolio-parented ("non-retirement") exclusion for this year
   *  — passed straight through to `routeForMode`, same single-dispatch
   *  invariant as `eligibility` above: MUST be the same record
   *  `decumulation-year.ts`'s real execution passes to its own
   *  `routeForMode` call, or this estimate and the real router disagree
   *  about how much money is available. */
  nonRetirement?: NonRetirementExclusion;
  /** Individual-account state for Roth growth-vs-basis taxability —
   *  this estimate must slice the SAME way the real execution does
   *  (distributeWithdrawals + depleteIndividualBasis), against CLONED
   *  indBal/indBasis so the estimate can never mutate real state. Omitted
   *  ⇒ rothTaxableGrowth stays 0, same as before this pass. */
  indAccts?: IndividualAccountInput[];
  indKey?: IndKeyFn;
  indBal?: Map<string, number>;
  indBasis?: Map<string, RothBasisState>;
  /** Projected calendar year -- required alongside the indAccts/indBal/
   *  indBasis quartet above to compute Roth qualification (age gate). */
  year?: number;
}

/** Output from the convergence estimation. */
interface TaxEstimationResult {
  /** The taxable Social Security the accepted trial ROUTED with (routing's
   *  bracket caps read it). The real year must route with this same figure
   *  to reproduce the accepted trial's slots, then prices its own taxable
   *  share from them, exactly as the trial did. */
  taxableSS: number;
  /** Estimated tax cost */
  estTax: number;
  /** Effective tax rate */
  effectiveTaxRate: number;
  /** Gross-up factor (1 / (1 - effectiveTaxRate)) */
  grossUpFactor: number;
  /** Grossed-up withdrawal need */
  grossedUpNeed: number;
  /** Target withdrawal (never above `totalBalance`) */
  targetWithdrawal: number;
  /** With `fixedGrossWithdrawal`: what it delivers after tax and penalty —
   *  the year's after-tax need, so every reader of that need (shortfall,
   *  RMD excess, post-RMD recompute) works unchanged. */
  derivedAfterTaxNeed?: number;
  /** Estimated early-withdrawal penalty cost — 0 whenever `hasIndTracking`
   *  is false or nothing was
   *  penalized (the overwhelming default case, since `routeForMode` already
   *  excludes penalty-exposed money when `avoidPenalizedWithdrawals` is
   *  on). Included in the gross-up cost scalar alongside `estTax` — see
   *  the loop body. */
  estPenalty: number;
}

/** One trial evaluation: cost (tax + penalty) of withdrawing exactly
 *  `trialWithdrawal`, routed and sliced EXACTLY the way the real execution
 *  will (routeForMode -> distributeWithdrawals -> depleteIndividualBasis ->
 *  splitRothWithdrawalForTax -> computeEarlyWithdrawalPenalty ->
 *  computeTaxFromSlots), against CLONED balances so this never mutates real
 *  state. Extracted to a single closure so the convergence loop
 *  below can call it repeatedly without a second hand-copy of this
 *  pipeline drifting from the first the way the earlier hand-
 *  simulated router drifted from the real one (see this file's header
 *  docblock) — RULES.md's single-computation-path rule applies within a
 *  function's own retries, not just across files. */
function evaluateCost(
  trialWithdrawal: number,
  laggedTaxableSS: number,
  input: TaxEstimationInput,
) {
  const {
    config,
    taxRates,
    balances,
    acctBal,
    eligibility,
    nonRetirement,
    indAccts,
    indKey,
    indBal,
    indBasis,
    year,
    filingStatus,
  } = input;
  const hasIndTracking =
    indAccts != null &&
    indKey != null &&
    indBal != null &&
    indBasis != null &&
    year != null;

  const clonedAcctBal = cloneAccountBalances(acctBal);
  // Same basis-derived ranking inputs the real
  // execution passes (deriveBasisRankingInputs's docblock) — no
  // magiBeforeThisDraw here, as in the real execution: routeForMode falls
  // back to its own ordinary-income floor.
  const { rothBasisAvailable, brokerageBasisRatio } = deriveBasisRankingInputs({
    balances,
    brokerageBasisRatio: input.brokerageBasisRatio,
    indBasis: hasIndTracking ? indBasis : undefined,
    indAccts: hasIndTracking ? indAccts : undefined,
    indKey: hasIndTracking ? indKey : undefined,
    indBal: hasIndTracking ? indBal : undefined,
    year: hasIndTracking ? year : undefined,
  });
  const routeResult = routeForMode(
    trialWithdrawal,
    config,
    clonedAcctBal,
    {
      taxBrackets: taxRates.taxBrackets,
      // The resolved (possibly per-year) value, as the real router reads
      // it: this estimate and the router apply the same routing rule.
      rothBracketTarget: config.rothBracketTarget ?? taxRates.rothBracketTarget,
      // Same rule, same reason as rothBracketTarget above: the
      // reserved-room estimate must target the rate a conversion will
      // ACTUALLY use, not necessarily the withdrawal target.
      conversionTarget:
        taxRates.rothConversionTarget ??
        config.rothBracketTarget ??
        taxRates.rothBracketTarget,
      taxableSS: laggedTaxableSS,
      filingStatus,
      ltcgBrackets: taxRates.ltcgBrackets,
      rothBasisAvailable,
      brokerageBasisRatio,
      conversionsEnabled: taxRates.enableRothConversions,
      // Passed as the real router passes it (same rule as above).
      standardDeduction: taxRates.standardDeduction,
      discretionaryWithdrawalOrder: config.discretionaryWithdrawalOrder,
    },
    eligibility,
    nonRetirement,
  );
  let rothTaxableGrowth = 0;
  let iterPenaltyCost = 0;
  if (hasIndTracking) {
    const clonedIndBal = new Map(indBal);
    const clonedIndBasis = new Map(indBasis);
    const preWithdrawalIndBal = new Map(clonedIndBal);
    const { decIndWithdrawal } = distributeWithdrawals(
      routeResult.slots,
      indAccts,
      indKey,
      clonedIndBal,
      eligibility,
    );
    const basisDraws = depleteIndividualBasis({
      indAccts,
      indKey,
      indBasis: clonedIndBasis,
      preWithdrawalBal: preWithdrawalIndBal,
      withdrawals: decIndWithdrawal,
    });
    rothTaxableGrowth = splitRothWithdrawalForTax({
      accounts: indAccts.map((ia) => ({
        indKey: indKey(ia),
        ownerBirthYear: ia.ownerBirthYear,
      })),
      draws: basisDraws,
      year,
    }).taxableGrowth;
    if (eligibility) {
      iterPenaltyCost = computeEarlyWithdrawalPenalty({
        exposure: eligibility,
        withdrawnByKey: decIndWithdrawal,
      }).penaltyCost;
    }
  }
  const price = (ss: number) =>
    computeTaxFromSlots({
      slots: routeResult.slots,
      taxableSS: ss,
      balances,
      brokerageBasisRatio,
      taxRates,
      filingStatus,
      rothTaxableGrowth,
      penaltyCost: iterPenaltyCost,
    });
  // Routing above read the caller's taxable Social Security (its bracket
  // caps only; `evaluateAtOwnSS` brings that figure to this trial's own);
  // the COST always uses this trial's own share, as the real year prices it
  // (with no filing status the flat 85% estimate stands, the conservative
  // side).
  let taxResult = price(laggedTaxableSS);
  let taxableSS = laggedTaxableSS;
  if (filingStatus && input.ssIncome > 0) {
    taxableSS = taxableSSFor(input.ssIncome, taxResult, filingStatus);
    taxResult = price(taxableSS);
  }
  // NIIT, priced as the year handler charges it (decumulation-year.ts).
  // Roth conversions run later and stay out of MAGI here.
  const niitMagi = yearMagi(
    {
      traditionalDraws: taxResult.totalTraditionalWithdrawal,
      rothTaxableGrowth: taxResult.rothTaxableGrowth,
      rothConversions: 0,
      realizedGains: taxResult.brokerageGainsPortion,
      socialSecurity: { taxable: taxableSS },
    },
    "niit",
  );
  const niit = filingStatus
    ? computeNiit(niitMagi, taxResult.brokerageGainsPortion, filingStatus)
    : 0;
  const taxCost = roundToCents(taxResult.taxCost + niit);
  const totalCost = roundToCents(taxCost + taxResult.penaltyCost);
  // What the withdrawal itself must cover (Social Security's surplus pays
  // the tax first, decumulation-year.ts credits the same amount).
  const surplusCredit = Math.min(input.ssSurplus ?? 0, taxCost);
  return {
    taxCost,
    taxableSS,
    penaltyCost: taxResult.penaltyCost,
    totalCost,
    netCost: roundToCents(totalCost - surplusCredit),
    // What the router couldn't deliver of this trial amount (account caps,
    // exclusion, or genuine balance exhaustion). The loop below grosses up
    // what IS delivered and stops once a larger trial delivers no more.
    routedUnmet: roundToCents(routeResult.unmetNeed ?? 0),
    // The taxable share routing's caps saw (the caller's lagged figure).
    routedWithSS: laggedTaxableSS,
  };
}

/** Rounds of the routing fixed point and how close (dollars) the routed share
 *  must come to the priced one. Short of it costs routing quality, never
 *  correctness: the real year routes with the accepted trial's figure. */
const SS_ROUTING_ROUNDS = 6;
const SS_ROUTING_TOLERANCE = 1;
/** The first trial's flat 85% share (a seed, not the statutory tier-2 rate). */
const FIRST_TRIAL_SS_SHARE = 0.85;

/**
 * `evaluateCost` at W, with routing's bracket caps reading W's OWN taxable
 * Social Security rather than a seed's. The two are coupled: the taxable
 * share depends on the Traditional draw, and with a Bracket Ceiling the
 * Traditional room is the income cap less that share. Routed with a stale
 * (higher) share, the same W draws more Roth and costs less, so a trial can
 * look like it meets the need when the routing it would really get falls
 * short (hundreds of dollars a year in the torpedo zone). Iterated on the
 * average of the routed and priced shares: plain substitution oscillates
 * there, since the map's slope is close to -1. Without Social Security, or
 * without a filing status (the flat estimate stands), the share never moves
 * and this is one evaluation.
 */
function evaluateAtOwnSS(W: number, seedSS: number, input: TaxEstimationInput) {
  let e = evaluateCost(W, seedSS, input);
  for (
    let round = 0;
    round < SS_ROUTING_ROUNDS &&
    Math.abs(e.taxableSS - e.routedWithSS) > SS_ROUTING_TOLERANCE;
    round++
  )
    e = evaluateCost(W, (e.taxableSS + e.routedWithSS) / 2, input);
  return e;
}

/**
 * A fixed gross withdrawal (a portfolio-sized strategy with Social Security
 * on top): no solving — evaluate the cost of W at its own taxable Social
 * Security share (`evaluateAtOwnSS`), and derive the after-tax need from
 * the strategy's FULL amount at that cost rate. Never from what the
 * balance or the router could deliver: a need cut down to what's there
 * would hide running out (no shortfall, plan "funded").
 */
function fixedWithdrawalEstimate(
  input: TaxEstimationInput,
  amount: number,
): TaxEstimationResult {
  const { ssIncome, totalBalance } = input;
  const W = roundToCents(Math.max(0, Math.min(amount, totalBalance)));
  const evalResult = evaluateAtOwnSS(W, ssIncome * FIRST_TRIAL_SS_SHARE, input);
  const taxableSS = evalResult.routedWithSS;
  const effectiveTaxRate = W > 0 ? evalResult.totalCost / W : 0;
  const derivedAfterTaxNeed = roundToCents(
    Math.max(0, amount * (1 - Math.min(1, effectiveTaxRate))),
  );
  return {
    taxableSS,
    estTax: evalResult.taxCost,
    estPenalty: evalResult.penaltyCost,
    effectiveTaxRate,
    // Nothing is grossed up: the withdrawal is the amount.
    grossUpFactor: 1,
    grossedUpNeed: W,
    targetWithdrawal: W,
    derivedAfterTaxNeed,
  };
}

/**
 * Resolves decumulation-year.ts's circular dependency — the withdrawal
 * amount depends on its own tax+penalty cost, which depends on the
 * withdrawal amount — by finding, to the cent, a W where the after-tax
 * proceeds cross the need: `delivered(W) - cost(W) >= afterTaxNeed`, where
 * `delivered` is what the router could actually move. (Proceeds aren't
 * monotone, so this is a crossing, not necessarily the smallest W.)
 *
 * `cost(W)` is NOT well behaved: routing tier switches and tax-table cliffs
 * make it jump, the early-withdrawal penalty adds kinks, and it isn't
 * monotone.
 * Each trial routes at its own taxable Social Security (`evaluateAtOwnSS`),
 * a fixed point reached to a dollar, not exactly. Costs are rounded to
 * cents, so a slope measured over a few cents is noise (a "rate" of
 * 0.99999999 sent a plain secant step to billions, and the balance cap then
 * accepted a trial that over-delivered by millions as if it were the
 * answer). The solver therefore assumes nothing about shape:
 *   - It keeps a bracket: `lo`, the largest trial that under-delivers, and
 *     `hi`, the smallest that over-delivers. A secant step is taken only
 *     when it lands strictly inside the bracket and the bracket halved
 *     within the last two steps; otherwise it bisects (Brent's safeguard:
 *     a secant crawling toward one end can't use up the trial cap).
 *   - No secant over less than $1: below that the slope is rounding noise,
 *     so it takes a Picard step (`W = need + cost(W)`) instead.
 *   - It stops short of the need only when a trial at `totalBalance`
 *     (or one the router can deliver no more of) still under-delivers.
 *     Otherwise an unconverged search returns `hi`, the smallest W found
 *     that meets the need; over a cost jump that over-delivers (spending
 *     above the budget) by at most the jump, never by an unbounded secant
 *     step. A shortfall at `lo` would be worse: the plan judge would read a
 *     solver artifact as a failed year.
 * Secant on the smooth stretches keeps the usual year at ~3 trials.
 *
 * The returned `taxableSS` is the figure the accepted trial routed with, so
 * the real year (which routes with it, then prices its own share from the
 * slots) reproduces the accepted trial exactly. Social Security's surplus,
 * when spending is under it, pays tax first: the equation is on `netCost`.
 */
export function estimateWithdrawalTaxCost(
  input: TaxEstimationInput,
): TaxEstimationResult {
  const { ssIncome, totalBalance, taxRates } = input;
  if (input.fixedGrossWithdrawal !== undefined)
    return fixedWithdrawalEstimate(input, input.fixedGrossWithdrawal);
  const { afterTaxNeed } = input;
  const shouldGrossUp = taxRates.grossUpForTaxes !== false;
  // At most 20 trials (each may route a few times, evaluateAtOwnSS).
  // Smooth years exit in ~3; the cap only binds where bisection is needed
  // across a cost jump, and 20 halvings take a five-figure bracket to
  // under $0.10 — inside the $1 of the need a year may stop at. Short of
  // the need, the gap is reported as unmet.
  const MAX_TRIALS = 20;
  const RESIDUAL_TOLERANCE = 0.01;
  // Below this span, a secant slope between two cent-rounded costs is noise.
  const MIN_SECANT_SPAN = 1;

  type Trial = { W: number; e: ReturnType<typeof evaluateAtOwnSS> };
  // What a trial actually delivers: the router can come up short of W.
  const deliveredOf = (t: Trial) => roundToCents(t.W - t.e.routedUnmet);
  const proceedsOf = (t: Trial) => deliveredOf(t) - t.e.netCost;
  const residualOf = (t: Trial) => roundToCents(afterTaxNeed - proceedsOf(t));

  // At W = need the proceeds can't exceed the need (cost is never
  // negative), so this first trial under-delivers or converges.
  const W0 = roundToCents(Math.max(0, Math.min(afterTaxNeed, totalBalance)));
  let trial: Trial = {
    W: W0,
    e: evaluateAtOwnSS(W0, ssIncome * FIRST_TRIAL_SS_SHARE, input),
  };

  let lo: Trial | null = null;
  let hi: Trial | null = null;
  // Bracket widths after the last two trials, for the forced bisection.
  let widthOneAgo = Infinity;
  let widthTwoAgo = Infinity;
  let prev: Trial | null = null;
  let trials = 1;

  while (shouldGrossUp) {
    const residual = residualOf(trial);
    if (Math.abs(residual) <= RESIDUAL_TOLERANCE) break;
    if (residual > 0) {
      // Short of the need, and no larger trial can do better: all the pool
      // holds is asked for, or the router delivered no more than at a
      // smaller trial. A router that falls short of the NEED alone (W =
      // need) still gets its delivered money grossed up. Once more W
      // delivers nothing more, the smaller trial is the answer: asking for
      // money that can't be reached only inflates the routed shortfall.
      if (trial.W >= totalBalance - 0.01) break;
      if (
        trial.e.routedUnmet > 0.01 &&
        lo != null &&
        deliveredOf(trial) <= deliveredOf(lo) + 0.01
      ) {
        trial = lo;
        break;
      }
      if (lo == null || trial.W > lo.W) lo = trial;
    } else if (hi == null || trial.W < hi.W) {
      hi = trial;
    }
    if (lo != null && hi != null && hi.W - lo.W <= 0.01) break;
    if (lo == null || trials >= MAX_TRIALS) break;
    const width = hi != null ? hi.W - lo.W : Infinity;
    const bisectNow = hi != null && width > widthTwoAgo / 2;
    widthTwoAgo = widthOneAgo;
    widthOneAgo = width;

    let nextW = afterTaxNeed + trial.e.netCost; // Picard
    if (prev != null && Math.abs(trial.W - prev.W) >= MIN_SECANT_SPAN) {
      const slope = (proceedsOf(trial) - proceedsOf(prev)) / (trial.W - prev.W);
      if (slope > 0 && Number.isFinite(slope))
        nextW = trial.W + residual / slope;
    }
    nextW = roundToCents(Math.min(nextW, totalBalance));
    if (bisectNow || !(nextW > lo.W && (hi == null || nextW < hi.W))) {
      nextW =
        hi != null
          ? roundToCents((lo.W + hi.W) / 2)
          : roundToCents(
              Math.min(totalBalance, lo.W + Math.max(0.01, residual)),
            );
    }

    prev = trial;
    trial = {
      W: nextW,
      e: evaluateAtOwnSS(nextW, trial.e.taxableSS, input),
    };
    trials++;
  }
  // Not converged: the smallest trial known to meet the need, if any.
  if (hi != null && Math.abs(residualOf(trial)) > RESIDUAL_TOLERANCE)
    trial = hi;

  const targetWithdrawal = trial.W;
  const totalCost = trial.e.totalCost;
  // Reporting-only from here -- grossUpFactor/effectiveTaxRate/grossedUpNeed
  // don't DRIVE targetWithdrawal (the search above sized it directly);
  // they're derived from the accepted evaluation for display/diagnostics,
  // matching what decumulation-year.ts's own post-RMD recompute already
  // treats them as.
  const effectiveTaxRate =
    afterTaxNeed > 0 ? totalCost / (afterTaxNeed + totalCost) : 0;
  const grossUpFactor =
    shouldGrossUp && effectiveTaxRate < 1 ? 1 / (1 - effectiveTaxRate) : 1;
  const grossedUpNeed = roundToCents(afterTaxNeed * grossUpFactor);

  return {
    taxableSS: trial.e.routedWithSS,
    estTax: trial.e.taxCost,
    estPenalty: trial.e.penaltyCost,
    effectiveTaxRate,
    grossUpFactor,
    grossedUpNeed,
    targetWithdrawal,
  };
}
