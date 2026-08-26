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
import type { EligibilityRecord } from "@/lib/pure/withdrawal-eligibility";
import {
  distributeWithdrawals,
  depleteIndividualBasis,
  type IndKeyFn,
} from "./individual-account-tracking";
import { splitRothWithdrawalForTax } from "@/lib/pure/roth-distribution-tax";
import type { RothBasisState } from "@/lib/pure/roth-basis-tracking";

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
}

/**
 * Run the SS convergence loop to estimate tax cost and compute gross-up factor.
 *
 * The convergence loop resolves the circular dependency:
 *   taxableSS depends on Traditional estimate → which depends on bracket cap →
 *   which depends on taxableSS.
 *
 * First pass uses flat 85% SS taxation, second pass uses accurate IRS formula
 * seeded by the first pass's Traditional estimate. Each pass routes a
 * candidate withdrawal of afterTaxNeed (pre-gross-up — the question being
 * answered is "what would it cost in tax to withdraw exactly the after-tax
 * need, before grossing up for that same tax") against a CLONED balance
 * snapshot via the real router, so routing never mutates the real balances.
 */
export function estimateWithdrawalTaxCost(
  input: TaxEstimationInput,
): TaxEstimationResult {
  const {
    afterTaxNeed,
    ssIncome,
    filingStatus,
    config,
    taxRates,
    balances,
    acctBal,
    totalBalance,
    eligibility,
    indAccts,
    indKey,
    indBal,
    indBasis,
    year,
  } = input;
  const hasIndTracking =
    indAccts != null &&
    indKey != null &&
    indBal != null &&
    indBasis != null &&
    year != null;

  let taxableSS = ssIncome * 0.85; // initial flat estimate
  let taxCost = 0;
  const ssIterations = filingStatus && ssIncome > 0 ? 2 : 1;

  for (let ssIter = 0; ssIter < ssIterations; ssIter++) {
    const clonedAcctBal = cloneAccountBalances(acctBal);
    const routeResult = routeForMode(
      afterTaxNeed,
      config,
      clonedAcctBal,
      {
        taxBrackets: taxRates.taxBrackets,
        rothBracketTarget: taxRates.rothBracketTarget,
        taxableSS,
      },
      eligibility,
    );
    // Slice this candidate routing the SAME way the real execution will
    // (distributeWithdrawals + depleteIndividualBasis), against CLONED
    // indBal/indBasis -- this estimate must never mutate the real Maps.
    // Cloning the Map suffices: applyBasisDraw replaces state objects
    // rather than mutating them in place.
    let rothTaxableGrowth = 0;
    if (hasIndTracking) {
      const clonedIndBal = new Map(indBal);
      const clonedIndBasis = new Map(indBasis);
      const preWithdrawalIndBal = new Map(clonedIndBal);
      const decIndWithdrawal = distributeWithdrawals(
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
    }
    const taxResult = computeTaxFromSlots({
      slots: routeResult.slots,
      taxableSS,
      balances,
      taxRates,
      filingStatus,
      rothTaxableGrowth,
    });
    taxCost = taxResult.taxCost;

    // After first iteration, recompute taxableSS using accurate IRS formula
    // seeded by the estimated Traditional withdrawal from this pass.
    if (ssIter === 0 && filingStatus && ssIncome > 0) {
      taxableSS = computeTaxableSS(
        ssIncome,
        taxResult.totalTraditionalWithdrawal,
        filingStatus,
      );
    }
  }

  const shouldGrossUp = taxRates.grossUpForTaxes !== false;
  // Not safeDivide candidates (advisor-reviewed, 2026-08-19):
  // effectiveTaxRate's guard variable (afterTaxNeed) differs from its actual
  // denominator (afterTaxNeed + estTax) — safeDivide(estTax, afterTaxNeed +
  // estTax, 0) is a different function (returns 1, not 0, when
  // afterTaxNeed === 0 and estTax > 0). grossUpFactor's `< 1` guard is the
  // same non-zero-denominator case as decumulation-year.ts's post-RMD
  // recompute above.
  const effectiveTaxRate =
    afterTaxNeed > 0 ? taxCost / (afterTaxNeed + taxCost) : 0;
  const grossUpFactor =
    shouldGrossUp && effectiveTaxRate < 1 ? 1 / (1 - effectiveTaxRate) : 1;
  const grossedUpNeed = roundToCents(afterTaxNeed * grossUpFactor);
  // Withdraw what's needed to cover expenses (grossed up for taxes).
  // Cap at total portfolio balance — can't withdraw more than you have.
  const targetWithdrawal = roundToCents(Math.min(grossedUpNeed, totalBalance));

  return {
    taxableSS,
    estTax: taxCost,
    effectiveTaxRate,
    grossUpFactor,
    grossedUpNeed,
    targetWithdrawal,
  };
}
