/**
 * Withdrawal tax gross-up: sizes the year's withdrawal against its own tax cost via
 * the real routeForMode + computeTaxFromSlots. Its own file to avoid an import
 * cycle; RMDs and conversions are applied after routing (decumulation-year.ts).
 */
import type { ResolvedDecumulationConfig } from "./types/decumulation";
import type {
  AccountBalances,
  TaxBuckets,
  IndividualAccountInput,
} from "../accounts/account-balances.types";
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
import { distributeWithdrawals } from "./individual-accounts/withdrawals";
import { depleteIndividualBasis } from "./individual-accounts/ledger";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { splitRothWithdrawalForTax } from "@/lib/pure/tax/roth-distribution-tax";
import type { RothBasisState } from "@/lib/pure/accounts/roth-basis-tracking";
import { computeEarlyWithdrawalPenalty } from "@/lib/pure/accounts/early-withdrawal-penalty";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";
import type {
  SolverFigures,
  TaxEstimationResult,
} from "./types/withdrawal-solver";

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
  /** Social Security beyond this year's spending; it pays the year's tax first
   *  and is never banked past that. 0 in a `fixedGrossWithdrawal` year. */
  ssSurplus: number;
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
    /** See RouteBracketInfo.conversionTarget's docblock (withdrawal-routing/types.ts). */
    rothConversionTarget?: number;
    taxMultiplier?: number;
    ltcgBrackets: Record<string, { threshold: number | null; rate: number }[]>;
    enableRothConversions?: boolean;
    /** Household's annual standard deduction; see
     *  `RouteBracketInfo.standardDeduction`. Must reach the router. */
    standardDeduction?: number;
  };
  /** Current balances by tax bucket */
  balances: TaxBuckets;
  /** Current per-account balances */
  accountBalance: AccountBalances;
  /** Every account's balance, Portfolio-parented included: the pool the target
   *  never exceeds. The search stops sooner, at what the router can reach;
   *  routing records the rest as `nonRetirementShortfall`. */
  totalBalance: number;
  /** The year's brokerage basis ratio for retirement withdrawals
   *  (brokerage-basis.ts) — the same one the real execution prices with.
   *  Omitted: the aggregate ratio. */
  brokerageBasisRatio?: number;
  /** This year's withdrawal eligibility, passed to `routeForMode`. Must be the
   *  record the real year passes, or the estimate's slot mix differs. */
  eligibility?: EligibilityRecord;
  /** This year's Portfolio-parented exclusion, passed to `routeForMode`. Must be
   *  the record the real year passes, like `eligibility`. */
  nonRetirement?: NonRetirementExclusion;
  /** Individual-account state for Roth growth-vs-basis taxability, sliced as
   *  the real year does against cloned maps (never mutated). Omitted ⇒
   *  rothTaxableGrowth stays 0. */
  indAccounts?: IndividualAccountInput[];
  indKey?: IndKeyFn;
  indBalance?: Map<string, number>;
  indBasis?: Map<string, RothBasisState>;
  /** Projected calendar year -- required alongside the indAccounts/indBalance/
   *  indBasis quartet above to compute Roth qualification (age gate). */
  year?: number;
}

/** Cost (tax + penalty) of withdrawing exactly `trialWithdrawal`, through the same
 *  pipeline as the real year (routeForMode → … → computeTaxFromSlots) on cloned
 *  balances. Every solver trial uses this one function. */
function evaluateCost(
  trialWithdrawal: number,
  laggedTaxableSS: number,
  input: TaxEstimationInput,
) {
  const {
    config,
    taxRates,
    balances,
    accountBalance,
    eligibility,
    nonRetirement,
    indAccounts,
    indKey,
    indBalance,
    indBasis,
    year,
    filingStatus,
  } = input;
  const hasIndTracking =
    indAccounts != null &&
    indKey != null &&
    indBalance != null &&
    indBasis != null &&
    year != null;

  const clonedAccountBalance = cloneAccountBalances(accountBalance);
  // Same basis-derived ranking inputs as the real year; no magiBeforeThisDraw,
  // so routeForMode uses its own ordinary-income floor.
  const { rothBasisAvailable, brokerageBasisRatio } = deriveBasisRankingInputs({
    balances,
    brokerageBasisRatio: input.brokerageBasisRatio,
    indBasis: hasIndTracking ? indBasis : undefined,
    indAccounts: hasIndTracking ? indAccounts : undefined,
    indKey: hasIndTracking ? indKey : undefined,
    indBalance: hasIndTracking ? indBalance : undefined,
    year: hasIndTracking ? year : undefined,
  });
  const routeResult = routeForMode(
    trialWithdrawal,
    config,
    clonedAccountBalance,
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
    const clonedIndBalance = new Map(indBalance);
    const clonedIndBasis = new Map(indBasis);
    const preWithdrawalIndBalance = new Map(clonedIndBalance);
    const { decumulationIndWithdrawal } = distributeWithdrawals(
      routeResult.slots,
      indAccounts,
      indKey,
      clonedIndBalance,
      eligibility,
    );
    const basisDraws = depleteIndividualBasis({
      indAccounts,
      indKey,
      indBasis: clonedIndBasis,
      preWithdrawalBalance: preWithdrawalIndBalance,
      withdrawals: decumulationIndWithdrawal,
    });
    rothTaxableGrowth = splitRothWithdrawalForTax({
      accounts: indAccounts.map((ia) => ({
        indKey: indKey(ia),
        ownerBirthYear: ia.ownerBirthYear,
      })),
      draws: basisDraws,
      year,
    }).taxableGrowth;
    if (eligibility) {
      iterPenaltyCost = computeEarlyWithdrawalPenalty({
        exposure: eligibility,
        withdrawnByKey: decumulationIndWithdrawal,
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
  // Routing read the caller's taxable SS (bracket caps only); the cost uses this
  // trial's own share, as the real year prices it. No filing status ⇒ flat 85%.
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
  const surplusCredit = Math.min(input.ssSurplus, taxCost);
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
 * `evaluateCost` with routing's bracket caps reading W's own taxable SS, which
 * itself depends on the Traditional draw. Iterates on the average of routed and
 * priced shares (plain substitution oscillates: slope near -1).
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

/** Within a cent of the need: the search has converged, and the need is met. */
const RESIDUAL_TOLERANCE = 0.01;

type Trial = { W: number; e: ReturnType<typeof evaluateAtOwnSS> };
// What a trial actually delivers: the router can come up short of W.
const deliveredOf = (t: Trial) => roundToCents(t.W - t.e.routedUnmet);
const proceedsOf = (t: Trial) => deliveredOf(t) - t.e.netCost;

function withStatus(figures: SolverFigures, shortfall: number) {
  return shortfall > RESIDUAL_TOLERANCE
    ? { ...figures, status: "capped" as const, shortfall }
    : { ...figures, status: "met" as const };
}

/**
 * Fixed gross withdrawal (SS on top): no solving. The after-tax need comes from
 * the full amount, so running out shows; the shortfall is the amount less what
 * left the portfolio.
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
  const figures = {
    taxableSS,
    estimatedTax: evalResult.taxCost,
    estimatedPenalty: evalResult.penaltyCost,
    effectiveTaxRate,
    // Nothing is grossed up: the withdrawal is the amount.
    grossUpFactor: 1,
    grossedUpNeed: W,
    targetWithdrawal: W,
    derivedAfterTaxNeed,
  };
  return withStatus(
    figures,
    roundToCents(amount - deliveredOf({ W, e: evalResult })),
  );
}

/**
 * Finds W with `delivered(W) - netCost(W) >= afterTaxNeed`, where cost jumps and
 * isn't monotone: a bracket search (secant inside it, else bisect; Picard under a
 * $1 span) returning `hi`, short of the need only when no larger W delivers more.
 */
export function estimateWithdrawalTaxCost(
  input: TaxEstimationInput,
): TaxEstimationResult {
  const { ssIncome, totalBalance, taxRates } = input;
  if (input.fixedGrossWithdrawal !== undefined)
    return fixedWithdrawalEstimate(input, input.fixedGrossWithdrawal);
  const { afterTaxNeed } = input;
  const shouldGrossUp = taxRates.grossUpForTaxes !== false;
  // Smooth years exit in ~3 trials; 20 halvings take a five-figure bracket under
  // $0.10, inside the $1 a year may stop at. Short of the need, the gap is unmet.
  const MAX_TRIALS = 20;
  // Below this span, a secant slope between two cent-rounded costs is noise.
  const MIN_SECANT_SPAN = 1;

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
      // Short of the need and no larger trial can do better: the whole pool is
      // asked for, or more W delivered nothing more (then the smaller trial wins;
      // asking for unreachable money only inflates the routed shortfall).
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
  // Reporting only: grossUpFactor/effectiveTaxRate/grossedUpNeed come from the
  // accepted evaluation and don't drive targetWithdrawal.
  const effectiveTaxRate =
    afterTaxNeed > 0 ? totalCost / (afterTaxNeed + totalCost) : 0;
  const grossUpFactor =
    shouldGrossUp && effectiveTaxRate < 1 ? 1 / (1 - effectiveTaxRate) : 1;
  const grossedUpNeed = roundToCents(afterTaxNeed * grossUpFactor);

  const figures = {
    taxableSS: trial.e.routedWithSS,
    estimatedTax: trial.e.taxCost,
    estimatedPenalty: trial.e.penaltyCost,
    effectiveTaxRate,
    grossUpFactor,
    grossedUpNeed,
    targetWithdrawal,
  };
  // Without gross-up the need is withdrawn as is: short only of what the
  // pool or the router couldn't deliver.
  return withStatus(
    figures,
    shouldGrossUp
      ? residualOf(trial)
      : roundToCents(afterTaxNeed - deliveredOf(trial)),
  );
}
