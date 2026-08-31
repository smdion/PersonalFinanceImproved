/**
 * Withdrawal tax gross-up — the SS-torpedo convergence loop that resolves
 * decumulation-year.ts's circular dependency: the amount that needs to be
 * withdrawn depends on the tax cost of withdrawing it, and the tax cost
 * depends on the withdrawal amount.
 *
 * Lives in its own file (split out of tax-estimation.ts, Phase 5 item 5.3)
 * because it needs to call withdrawal-routing.ts's routeForMode — and
 * withdrawal-routing.ts itself imports incomeCapForMarginalRate from
 * tax-estimation.ts, so estimateWithdrawalTaxCost living in tax-estimation.ts
 * would create an import cycle. This file sits above both: it imports the
 * pure tax math from tax-estimation.ts and the real router from
 * withdrawal-routing.ts, and neither of those needs to import this file back.
 *
 * Before this split, the convergence loop hand-simulated bracket-filling and
 * waterfall routing separately from the real router — and had silently
 * drifted from it in three ways (Batch 2 Finding 10 / advisor design review,
 * 2026-08-19):
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
import type {
  ResolvedDecumulationConfig,
  AccountBalances,
  TaxBuckets,
  FilingStatusType,
  IndividualAccountInput,
} from "../types";
import { roundToCents } from "../../utils/math";
import { cloneAccountBalances } from "./balance-utils";
import {
  computeTaxableSS,
  computeTaxFromSlots,
  type WithholdingBracket,
} from "./tax-estimation";
import { routeForMode } from "./withdrawal-routing";
import { deriveBasisRankingInputs } from "./withdrawal-cost-ranking";
import type {
  EligibilityRecord,
  NonRetirementExclusion,
} from "@/lib/pure/withdrawal-eligibility";
import {
  distributeWithdrawals,
  depleteIndividualBasis,
  type IndKeyFn,
} from "./individual-account-tracking";
import { splitRothWithdrawalForTax } from "@/lib/pure/roth-distribution-tax";
import type { RothBasisState } from "@/lib/pure/roth-basis-tracking";
import { computeEarlyWithdrawalPenalty } from "@/lib/pure/early-withdrawal-penalty";

/** Input for the convergence estimation. */
export interface TaxEstimationInput {
  /** After-tax spending need (expenses - SS income) */
  afterTaxNeed: number;
  /** Social Security income for this year */
  ssIncome: number;
  /** Filing status for SS taxation thresholds */
  filingStatus: FilingStatusType | null | undefined;
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
    taxMultiplier?: number;
    ltcgBrackets?: Record<string, { threshold: number | null; rate: number }[]>;
    enableRothConversions?: boolean;
    /** Household's annual standard deduction — see `RouteBracketInfo.standardDeduction`
     *  (withdrawal-routing.ts). Declared here (not just structurally passed
     *  through) so it's a documented contract, not a field the next reader
     *  could "clean up" by destructuring and dropping — this module's own
     *  header docblock is a record of exactly that failure mode happening
     *  before (2026-08-19 routing-divergence fixes). */
    standardDeduction?: number;
  };
  /** Current balances by tax bucket */
  balances: TaxBuckets;
  /** Current per-account balances */
  acctBal: AccountBalances;
  /** Total portfolio balance */
  totalBalance: number;
  /** Withdrawal-ordering eligibility for this year (v0.7.8, PLAN-v0.7.8-v4
   *  Group 2.2) — passed straight through to `routeForMode`. MUST be the
   *  same record `decumulation-year.ts`'s real execution passes to its own
   *  `routeForMode` call: the single-dispatch invariant this module's
   *  header docblock documents applies to this parameter too — a mismatch
   *  here would desync the tax-gross-up estimate's slot mix from the real
   *  router's, the same class of bug the routeForMode extraction fixed for
   *  the routing-mode-specific rules. */
  eligibility?: EligibilityRecord;
  /** Portfolio-parented ("non-retirement") exclusion for this year (R49)
   *  — passed straight through to `routeForMode`, same single-dispatch
   *  invariant as `eligibility` above: MUST be the same record
   *  `decumulation-year.ts`'s real execution passes to its own
   *  `routeForMode` call, or this estimate and the real router disagree
   *  about how much money is available. */
  nonRetirement?: NonRetirementExclusion;
  /** Individual-account state for Roth growth-vs-basis taxability (v0.7.8
   *  Roth-tax-basis follow-up, DESIGN-DECISION-v0.7.8-roth-tax-basis.md §
   *  Q3) — this estimate must slice the SAME way the real execution does
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
export interface TaxEstimationResult {
  /** Final taxable Social Security amount */
  taxableSS: number;
  /** Estimated tax cost */
  estTax: number;
  /** Effective tax rate */
  effectiveTaxRate: number;
  /** Gross-up factor (1 / (1 - effectiveTaxRate)) */
  grossUpFactor: number;
  /** Grossed-up withdrawal need */
  grossedUpNeed: number;
  /** Target withdrawal (capped at total balance) */
  targetWithdrawal: number;
  /** Estimated early-withdrawal penalty cost (v0.7.8 penalty-hard-exclusion
   *  follow-up) — 0 whenever `hasIndTracking` is false or nothing was
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
 *  state. Extracted to a single closure (advisor review, 2026-08-26,
 *  v0.7.8 penalty-hard-exclusion gross-up fix) so the convergence loop
 *  below can call it repeatedly without a second hand-copy of this
 *  pipeline drifting from the first the way the pre-2026-08-19 hand-
 *  simulated router drifted from the real one (see this file's header
 *  docblock) — RULES.md's single-computation-path rule applies within a
 *  function's own retries, not just across files. */
function evaluateCost(
  trialWithdrawal: number,
  taxableSS: number,
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
  // v0.7.9 R40 follow-up: same basis-derived ranking inputs the real
  // execution passes (deriveBasisRankingInputs's docblock) — no
  // magiBeforeThisDraw here (this file has no magiHistory access; falls
  // back to routeForMode's own ordinary-income-floor proxy, acceptable
  // for a convergence-loop trial, not final pricing).
  const { rothBasisAvailable, brokerageBasisRatio } = deriveBasisRankingInputs({
    balances,
    indBasis: hasIndTracking ? indBasis : undefined,
    indAccts: hasIndTracking ? indAccts : undefined,
    indKey: hasIndTracking ? indKey : undefined,
  });
  const routeResult = routeForMode(
    trialWithdrawal,
    config,
    clonedAcctBal,
    {
      taxBrackets: taxRates.taxBrackets,
      // Added 2026-08-29: read the resolved (possibly per-year-overridden)
      // value, same fix as the real router's own call site
      // (decumulation-year.ts) -- this file's own header docblock (Part
      // "2." above) says this estimate and the real router must never
      // diverge on what routing rule applies; leaving this unresolved
      // would violate that for any household using the new override.
      rothBracketTarget: config.rothBracketTarget ?? taxRates.rothBracketTarget,
      taxableSS,
      filingStatus,
      ltcgBrackets: taxRates.ltcgBrackets,
      rothBasisAvailable,
      brokerageBasisRatio,
      conversionsEnabled: taxRates.enableRothConversions,
      // Fixed alongside R59 (2026-08-30) — this was missing entirely, a
      // live divergence from the real router's own call site
      // (decumulation-year.ts), which has passed this since the LTCG fix
      // earlier in this same session. Same rule as the rothBracketTarget
      // comment above: this estimate and the real router must never
      // diverge on what routing rule applies.
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
  const taxResult = computeTaxFromSlots({
    slots: routeResult.slots,
    taxableSS,
    balances,
    taxRates,
    filingStatus,
    rothTaxableGrowth,
    penaltyCost: iterPenaltyCost,
  });
  return {
    taxCost: taxResult.taxCost,
    penaltyCost: taxResult.penaltyCost,
    totalCost: roundToCents(taxResult.taxCost + taxResult.penaltyCost),
    totalTraditionalWithdrawal: taxResult.totalTraditionalWithdrawal,
    // A trial can't be improved on by withdrawing more if the router
    // already couldn't deliver the full trial amount (account caps,
    // exclusion, or genuine balance exhaustion) — the clamp guard below
    // uses this to stop iterating instead of chasing an unreachable W.
    routedShort: (routeResult.unmetNeed ?? 0) > 0.01,
  };
}

/**
 * Resolves decumulation-year.ts's circular dependency — the withdrawal
 * amount depends on its own tax+penalty cost, which depends on the
 * withdrawal amount — by solving `W - cost(W) = afterTaxNeed` for W.
 *
 * `cost(W)` is piecewise LINEAR in W (progressive tax brackets are
 * piecewise linear; the early-withdrawal penalty is piecewise linear with
 * a kink at each account's `penaltyFreeAmount` — 0% below, 10-20% above),
 * and monotone with slope < 1 (no real tax+penalty system takes >100% of
 * a marginal dollar). That makes `f(W) = W - cost(W) - afterTaxNeed` a
 * monotone piecewise-linear root-finding problem: SECANT iteration lands
 * on the root in one or two more evaluations once two points are known
 * (exactly, when both points sit in the same linear segment), which is
 * why this converges in ~3 evaluations rather than the ~7+ a repeated
 * `W = need + cost(W)` (Picard) step would need for the same accuracy —
 * that single-Picard-step version is what this function did before this
 * fix, and it silently under-withdrew whenever a fixed-dollar-cap cost
 * (the penalty) made the "rate measured at the smaller pre-gross-up
 * trial" an underestimate of the true marginal rate on the larger grossed-
 * up dollars (advisor review, 2026-08-26 — see criterion 7's test in
 * tests/calculators/penalty-hard-exclusion-both-paths-agree.test.ts for
 * the reproduction: a ~7% real shortfall, silent, no unmetNeed flagged).
 *
 * taxableSS's own circular dependency (taxableSS depends on the
 * Traditional withdrawal, which depends on W) is resolved in the SAME
 * loop rather than nested inside it (advisor review) — every evaluation
 * both refines taxableSS (from that evaluation's totalTraditionalWithdrawal)
 * and produces the next trial W, so the returned taxableSS/targetWithdrawal
 * pair is always mutually consistent with a single accepted evaluation,
 * never a stale taxableSS paired with an extrapolated W that was never
 * itself evaluated.
 */
export function estimateWithdrawalTaxCost(
  input: TaxEstimationInput,
): TaxEstimationResult {
  const { afterTaxNeed, ssIncome, filingStatus, totalBalance, taxRates } =
    input;
  const shouldGrossUp = taxRates.grossUpForTaxes !== false;
  const MAX_EVALUATIONS = 4;
  const RESIDUAL_TOLERANCE = 0.01;

  let taxableSS = ssIncome * 0.85; // initial flat estimate
  let W = afterTaxNeed;
  let evalResult = evaluateCost(W, taxableSS, input);
  if (filingStatus && ssIncome > 0) {
    taxableSS = computeTaxableSS(
      ssIncome,
      evalResult.totalTraditionalWithdrawal,
      filingStatus,
    );
    // taxableSS changed -> re-evaluate at the SAME trial W with the
    // refined SS taxability before this point becomes the loop's first
    // secant anchor (accepting the stale-taxableSS evaluation here would
    // just reintroduce the same "extrapolate from a point that wasn't
    // really evaluated" bug this whole rewrite exists to remove).
    evalResult = evaluateCost(W, taxableSS, input);
  }

  let prevW: number | null = null;
  let prevCost: number | null = null;
  let evaluations = 1;

  while (shouldGrossUp && evaluations < MAX_EVALUATIONS) {
    const clamped = W >= totalBalance - 0.01 || evalResult.routedShort;
    const proceeds = W - evalResult.totalCost;
    const residual = afterTaxNeed - proceeds;
    if (Math.abs(residual) <= RESIDUAL_TOLERANCE || clamped) break;

    let nextW: number;
    if (prevW == null || prevCost == null || Math.abs(W - prevW) < 0.01) {
      // No usable second point yet for a secant slope -- one Picard step
      // (W = need + cost(W)) to generate one.
      nextW = roundToCents(afterTaxNeed + evalResult.totalCost);
    } else {
      const marginalRate = (evalResult.totalCost - prevCost) / (W - prevW);
      nextW =
        marginalRate < 1 && Number.isFinite(marginalRate)
          ? roundToCents(W + residual / (1 - marginalRate))
          : roundToCents(afterTaxNeed + evalResult.totalCost); // degenerate slope -> fall back to a Picard step
    }
    nextW = Math.min(nextW, totalBalance);
    if (Math.abs(nextW - W) < 0.01) break; // no more progress possible (likely the balance clamp)

    prevW = W;
    prevCost = evalResult.totalCost;
    W = nextW;
    if (filingStatus && ssIncome > 0) {
      taxableSS = computeTaxableSS(
        ssIncome,
        evalResult.totalTraditionalWithdrawal,
        filingStatus,
      );
    }
    evalResult = evaluateCost(W, taxableSS, input);
    evaluations++;
  }

  const targetWithdrawal = roundToCents(Math.min(W, totalBalance));
  const totalCost = evalResult.totalCost;
  // Reporting-only from here -- grossUpFactor/effectiveTaxRate/grossedUpNeed
  // no longer DRIVE targetWithdrawal (the loop above already converged it
  // directly); they're derived from the accepted evaluation purely for
  // display/diagnostics, matching what decumulation-year.ts's own post-RMD
  // recompute already treats them as.
  const effectiveTaxRate =
    afterTaxNeed > 0 ? totalCost / (afterTaxNeed + totalCost) : 0;
  const grossUpFactor =
    shouldGrossUp && effectiveTaxRate < 1 ? 1 / (1 - effectiveTaxRate) : 1;
  const grossedUpNeed = roundToCents(afterTaxNeed * grossUpFactor);

  return {
    taxableSS,
    estTax: evalResult.taxCost,
    estPenalty: evalResult.penaltyCost,
    effectiveTaxRate,
    grossUpFactor,
    grossedUpNeed,
    targetWithdrawal,
  };
}
