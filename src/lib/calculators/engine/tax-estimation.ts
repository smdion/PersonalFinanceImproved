/**
 * Tax Estimation — tax bracket estimation, SS taxation, and tax-from-slots.
 *
 * Contains:
 *   - estimateEffectiveTaxRate: W-4 bracket-based effective tax rate
 *   - incomeCapForMarginalRate: bracket threshold lookup for bracket-filling
 *   - computeTaxableSS: IRS provisional income formula (3-tier)
 *   - computeTaxFromSlots: tax cost of a completed withdrawal routing result
 *
 * The SS-convergence gross-up loop that used to live here moved to
 * tax-gross-up.ts (Phase 5 item 5.3) — it needs to call withdrawal-routing.ts,
 * which imports incomeCapForMarginalRate from this file, so it couldn't stay
 * here without creating an import cycle. See that file's header for why.
 *
 * Used by the orchestrator (via tax-gross-up.ts) and withdrawal-routing
 * (bracket-filling needs incomeCapForMarginalRate).
 */
import type { TaxBuckets, FilingStatusType, DecumulationSlot } from "../types";
import { roundToCents, sumBy } from "../../utils/math";
import {
  getAccountTypeConfig,
  isOverflowTarget,
} from "../../config/account-types";
import { computeLtcgTax, toLtcgTaxableIncome } from "../../config/tax-tables";
import { MAX_EFFECTIVE_TAX_RATE } from "../../constants";

// ---------------------------------------------------------------------------
// Tax bracket estimator — computes effective tax rate on traditional withdrawals
// ---------------------------------------------------------------------------

export type WithholdingBracket = {
  threshold: number;
  baseWithholding: number;
  rate: number;
};

/**
 * Gross ordinary income -> the adjusted-annual-wage figure the Pub 15-T
 * percentage-method table (`WithholdingBracket[]`) is actually denominated
 * in. The table's own first non-zero threshold IS the Pub 15-T Worksheet 1A
 * offset (e.g. $19,300 MFJ for 2026 — R56/R58), so the residual still owed
 * is `standardDeduction - thatThreshold`, derived from the table already in
 * hand rather than a second stored constant. `standardDeduction` undefined
 * returns gross unchanged (pre-R56 behavior, still correct for callers that
 * don't have a standard deduction to thread through, e.g. tests).
 *
 * Deliberately does NOT reuse `toLtcgTaxableIncome`/`toTaxableIncomeBrackets`
 * (tax-tables.ts / tax-brackets.ts) — those shift `TaxBracket{min,max,rate}`
 * boundaries for a true progressive walk; this shifts the INCOME instead,
 * which is the only safe move against `WithholdingBracket{threshold,
 * baseWithholding,rate}`'s baseWithholding-shortcut shape (shifting
 * `threshold` alone without recomputing `baseWithholding` would be wrong).
 */
export function toOrdinaryBracketIncome(
  grossOrdinaryIncome: number,
  brackets: WithholdingBracket[],
  standardDeduction: number | undefined,
): number {
  if (standardDeduction == null) return grossOrdinaryIncome;
  const firstTaxedThreshold = brackets.find((b) => b.rate > 0)?.threshold ?? 0;
  const residual = Math.max(0, standardDeduction - firstTaxedThreshold);
  return Math.max(0, grossOrdinaryIncome - residual);
}

/**
 * Estimate effective federal income tax rate on traditional retirement withdrawals.
 * Uses W-4 withholding brackets. NOTE: these embed only the smaller Pub 15-T
 * Worksheet 1A adjustment in the 0% bracket's ceiling (e.g. $19,300 MFJ for
 * 2026), NOT the full standard deduction ($32,200 MFJ) — verified via
 * tests/config/tax-freshness.test.ts's structural invariants (R56/R58).
 * Pass `standardDeduction` so the bracket lookup subtracts the remaining
 * residual via `toOrdinaryBracketIncome` — omitting it (undefined) keeps
 * the old, overstating-by-the-residual behavior; it's optional only so
 * call sites without a standard deduction handy still compile.
 *
 * @param taxableIncome - Total taxable income (traditional withdrawals + taxable SS)
 * @param brackets - W-4 withholding brackets (from tax_brackets table), sorted by threshold ascending
 * @param taxMultiplier - Scales the computed tax (1.0 = current law, 1.2 = 20% higher, etc.)
 * @param standardDeduction - Filing status's standard deduction, for the Worksheet 1A residual (R56)
 * @returns Effective tax rate as decimal (e.g. 0.14 = 14%), against GROSS taxableIncome —
 *   callers multiply this rate back against gross dollars, so the denominator here
 *   stays gross even though the bracket lookup itself runs on the reduced base.
 */
export function estimateEffectiveTaxRate(
  taxableIncome: number,
  brackets: WithholdingBracket[],
  taxMultiplier: number = 1.0,
  standardDeduction?: number,
): number {
  if (taxableIncome <= 0 || brackets.length === 0) return 0;

  const bracketIncome = toOrdinaryBracketIncome(
    taxableIncome,
    brackets,
    standardDeduction,
  );
  if (bracketIncome <= 0) return 0;

  // Find the applicable bracket
  let tax = 0;
  for (let i = brackets.length - 1; i >= 0; i--) {
    const b = brackets[i]!;
    if (bracketIncome >= b.threshold) {
      tax = b.baseWithholding + (bracketIncome - b.threshold) * b.rate;
      break;
    }
  }

  tax *= taxMultiplier;
  return Math.min(tax / taxableIncome, MAX_EFFECTIVE_TAX_RATE); // cap sanity check — gross denominator
}

/**
 * Find the maximum taxable income that stays within a target marginal rate.
 * Returns the threshold of the first bracket whose rate exceeds the target,
 * converted back to GROSS income space by adding back the Worksheet 1A
 * residual (R56) — callers use the return value as a gross withdrawal cap.
 * If no bracket exceeds the target, returns Infinity (no cap needed).
 */
export function incomeCapForMarginalRate(
  targetRate: number,
  brackets: WithholdingBracket[],
  standardDeduction?: number,
): number {
  for (const b of brackets) {
    if (b.rate > targetRate) {
      if (standardDeduction == null) return b.threshold;
      const firstTaxedThreshold =
        brackets.find((br) => br.rate > 0)?.threshold ?? 0;
      const residual = Math.max(0, standardDeduction - firstTaxedThreshold);
      return b.threshold + residual;
    }
  }
  return Infinity;
}

/**
 * The marginal ordinary rate that applies to a dollar of income sitting
 * JUST ABOVE `targetRate`'s bracket ceiling — i.e. the rate on the next
 * bracket up. Companion to `incomeCapForMarginalRate` (same bracket walk,
 * returns `.rate` instead of `.threshold`) — used by v0.7.9's cost-aware
 * withdrawal ranking to price a non-qualified Roth growth withdrawal, which
 * stacks as ordinary income on top of whatever Phase 1 already filled up to
 * the target bracket cap. Falls back to `targetRate` itself (not a real
 * bracket rate, but the least-wrong value) when no bracket exceeds it.
 */
export function marginalRateAboveTarget(
  targetRate: number,
  brackets: WithholdingBracket[],
): number {
  for (const b of brackets) {
    if (b.rate > targetRate) return b.rate;
  }
  return targetRate;
}

/**
 * The marginal ordinary rate for the NEXT dollar earned at `income` — i.e.
 * the rate on the bracket `income` currently sits in. Same bracket walk as
 * `estimateEffectiveTaxRate` (highest threshold <= income), but returns
 * `.rate` for that bracket directly instead of computing a total tax
 * amount (advisor review, 2026-08-29 — `marginalRateAboveTarget` answers
 * a DIFFERENT question, "what's the rate on the bracket above a given
 * RATE," and was being misused to price a withdrawal stacking on top of
 * `ordinaryIncomeFloor`'s real DOLLAR income level. That's only correct
 * when Phase 1 actually filled Traditional up to the bracket-filling
 * target — routing also reaches this ranking when Traditional simply ran
 * out below the target, where `ordinaryIncomeFloor` sits in a LOWER
 * bracket than `targetRate` implies, and pricing off `targetRate`
 * systematically overprices the withdrawal). Returns 0 for `income <= 0`
 * or an empty bracket list, matching `estimateEffectiveTaxRate`'s
 * "nothing taxable" convention. Pass `standardDeduction` for the Worksheet
 * 1A residual (R56) — a household whose gross sits between the table's
 * first threshold and the full standard deduction now correctly returns
 * 0% here instead of the first nonzero bracket's rate.
 */
export function marginalRateAtIncome(
  income: number,
  brackets: WithholdingBracket[],
  standardDeduction?: number,
): number {
  if (income <= 0 || brackets.length === 0) return 0;
  const bracketIncome = toOrdinaryBracketIncome(
    income,
    brackets,
    standardDeduction,
  );
  if (bracketIncome <= 0) return 0;
  for (let i = brackets.length - 1; i >= 0; i--) {
    const b = brackets[i]!;
    if (bracketIncome >= b.threshold) return b.rate;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Social Security taxation — IRS provisional income formula (Phase 2)
// ---------------------------------------------------------------------------

/** SS taxation thresholds by filing status (unchanged since 1993). */
const SS_TAX_THRESHOLDS: Record<string, { tier1: number; tier2: number }> = {
  MFJ: { tier1: 32000, tier2: 44000 },
  Single: { tier1: 25000, tier2: 34000 },
  HOH: { tier1: 25000, tier2: 34000 }, // Same as Single
};

/**
 * Compute the taxable portion of Social Security income using the IRS
 * 3-tier provisional income formula.
 *
 * Provisional income = other taxable income + 0.5 × SS income + tax-exempt interest
 *
 * - Below tier 1: 0% taxable
 * - Tier 1 → tier 2: up to 50% taxable
 * - Above tier 2: up to 85% taxable
 *
 * The "tax torpedo" zone between tiers creates effective marginal rates of 40-46%.
 */
export function computeTaxableSS(
  ssIncome: number,
  otherTaxableIncome: number,
  filingStatus: FilingStatusType,
  taxExemptInterest: number = 0,
): number {
  if (ssIncome <= 0) return 0;

  const thresholds = SS_TAX_THRESHOLDS[filingStatus];
  if (!thresholds) return ssIncome * 0.85; // fallback

  // IRS Pub 915: provisional income includes tax-exempt interest (e.g. municipal bonds)
  const provisionalIncome =
    otherTaxableIncome + 0.5 * ssIncome + taxExemptInterest;

  if (provisionalIncome <= thresholds.tier1) {
    return 0;
  }

  // Tier 1 → Tier 2: up to 50% of SS is taxable
  const tier1Excess = Math.min(
    provisionalIncome - thresholds.tier1,
    thresholds.tier2 - thresholds.tier1,
  );
  let taxable = Math.min(0.5 * tier1Excess, 0.5 * ssIncome);

  // Above tier 2: up to 85% of SS is taxable
  if (provisionalIncome > thresholds.tier2) {
    const tier2Excess = provisionalIncome - thresholds.tier2;
    taxable = Math.min(taxable + 0.85 * tier2Excess, 0.85 * ssIncome);
  }

  return roundToCents(Math.max(0, taxable));
}

// ---------------------------------------------------------------------------
// Tax cost from a completed set of withdrawal slots
// ---------------------------------------------------------------------------

export interface ComputeTaxFromSlotsInput {
  /** The routed withdrawal, from any of withdrawal-routing.ts's route*
   *  functions — real execution or a candidate estimate, this function
   *  doesn't care which. */
  slots: DecumulationSlot[];
  /** Taxable Social Security for this year (already resolved by the caller). */
  taxableSS: number;
  /** Current balances by tax bucket — only afterTax/afterTaxBasis are read,
   *  for the brokerage basis-ratio split. */
  balances: Pick<TaxBuckets, "afterTax" | "afterTaxBasis">;
  /** Authoritative totals when the caller already has them (e.g. post-RMD
   *  in decumulation-year.ts, where rmd-enforcement.ts tracks the total
   *  incrementally via its own running `+=` + roundToCents, which is not
   *  bit-for-bit identical to a fresh roundToCents(sumBy(slots, ...)) over
   *  the same mutated slots — both are correct, but only one matches what
   *  was actually used elsewhere in that computation, so re-deriving here
   *  would silently introduce a sub-cent drift). Omit to derive from slots
   *  directly (correct for tax-gross-up.ts's estimate, which never runs
   *  RMD enforcement and has no other source of truth). */
  totalTraditionalWithdrawal?: number;
  totalRothWithdrawal?: number;
  /** Growth drawn from NON-QUALIFIED Roth distributions this year — ordinary
   *  income (v0.7.8 Roth-tax-basis follow-up, from
   *  `roth-distribution-tax.ts`'s `splitRothWithdrawalForTax`). Omitted or
   *  undefined ⇒ the arithmetic reduces exactly to treating the whole Roth
   *  withdrawal at `taxRates.roth` (today's behavior) — see
   *  DESIGN-DECISION-v0.7.8-roth-tax-basis.md acceptance criterion 1. */
  rothTaxableGrowth?: number;
  /** 10%/20% early-withdrawal penalty cost this year, from
   *  `early-withdrawal-penalty.ts`'s `computeEarlyWithdrawalPenalty`
   *  (v0.7.8 penalty-hard-exclusion follow-up). An EXCISE, not income tax —
   *  must NOT enter `actualTaxableIncome` (would inflate the marginal rate
   *  and the LTCG stacking base) and must NOT be summed into `taxCost`
   *  (every downstream consumer reads `taxCost` as income tax only).
   *  Omitted or undefined ⇒ the arithmetic reduces exactly to today's. */
  penaltyCost?: number;
  taxRates: {
    traditionalFallbackRate: number;
    roth: number;
    hsa: number;
    brokerage: number;
    taxBrackets?: WithholdingBracket[];
    taxMultiplier?: number;
    ltcgBrackets?: Record<string, { threshold: number | null; rate: number }[]>;
    /** See `toLtcgTaxableIncome`'s docblock — converts `actualTaxableIncome`
     *  (gross) into real taxable income before the LTCG bracket lookup
     *  below. Omitted ⇒ 0 (pre-2026-08-30 behavior). */
    standardDeduction?: number;
  };
  filingStatus: FilingStatusType | null | undefined;
}

export interface ComputeTaxFromSlotsResult {
  taxCost: number;
  actualTraditionalRate: number;
  /** `totalTraditionalWithdrawal + rothTaxableGrowth + taxableSS` — the
   *  single source of truth for "real ordinary income this year," BEFORE
   *  LTCG/bracket stacking. Callers must read this rather than
   *  re-deriving their own copy (e.g. `totalTraditionalWithdrawal +
   *  taxableSS` alone silently drops non-qualified Roth growth income —
   *  exactly the bug this field was added to prevent, advisor review
   *  2026-08-27). Feeds `revisedOrdinary`/MAGI/LTCG-bracket calculations
   *  downstream in decumulation-year.ts. */
  actualTaxableIncome: number;
  /** Return-of-basis portion of the brokerage withdrawal (tax-free). Caller
   *  is responsible for annotating the brokerage slot with this if needed —
   *  this function only reads slots, it doesn't mutate them. */
  brokerageBasisPortion: number;
  /** Taxable-gains portion of the brokerage withdrawal. */
  brokerageGainsPortion: number;
  /** Tax cost attributable to the brokerage withdrawal alone (subset of
   *  taxCost) — exposed directly rather than making callers reverse-derive
   *  it from taxCost, since that would require re-summing already-rounded
   *  components and risks a rounding mismatch. */
  brokerageTaxCost: number;
  totalTraditionalWithdrawal: number;
  totalRothWithdrawal: number;
  hsaWithdrawal: number;
  brokerageWithdrawal: number;
  /** Echoes `input.rothTaxableGrowth`, defaulted to 0 — the portion of
   *  `totalRothWithdrawal` taxed as ordinary income this year. */
  rothTaxableGrowth: number;
  /** `totalRothWithdrawal - rothTaxableGrowth` — taxed at `taxRates.roth`
   *  (0 by default). Exposed directly for the same reason
   *  `brokerageBasisPortion` is: callers must not reverse-derive an
   *  already-rounded component. */
  rothTaxFreePortion: number;
  /** Echoes `input.penaltyCost`, defaulted to 0. NOT included in `taxCost`
   *  — a separate output field for the same reason it's a separate input
   *  (see `ComputeTaxFromSlotsInput.penaltyCost`'s docblock). */
  penaltyCost: number;
}

/**
 * Compute the tax cost of a completed withdrawal routing result. Single
 * source of truth for "how much tax does this set of slots cost" — used by
 * both the real decumulation-year execution AND tax-gross-up.ts's
 * estimateWithdrawalTaxCost convergence loop, so the two can never silently
 * diverge on the tax math itself (Batch 2 Finding 10 / Phase 5 item 5.3).
 */
export function computeTaxFromSlots(
  input: ComputeTaxFromSlotsInput,
): ComputeTaxFromSlotsResult {
  const { slots, taxableSS, balances, taxRates, filingStatus } = input;

  const totalTraditionalWithdrawal =
    input.totalTraditionalWithdrawal ??
    roundToCents(sumBy(slots, (s) => s.traditionalWithdrawal));
  const totalRothWithdrawal =
    input.totalRothWithdrawal ??
    roundToCents(sumBy(slots, (s) => s.rothWithdrawal));
  const hsaWithdrawal =
    slots.find(
      (s) =>
        getAccountTypeConfig(s.category).balanceStructure === "single_bucket",
    )?.withdrawal ?? 0;
  const brokerageSlot = slots.find((s) => isOverflowTarget(s.category));
  const brokerageWithdrawal = brokerageSlot?.withdrawal ?? 0;
  // Taxable Roth growth (non-qualified distributions, v0.7.8
  // Roth-tax-basis follow-up) is ordinary income — it must enter
  // actualTaxableIncome BEFORE bracket/LTCG stacking below, not just get
  // summed into taxCost afterward, or the marginal rate and the LTCG
  // stacking base would both understate real taxable income. Undefined
  // input reduces this to exactly 0, matching today's behavior.
  const rothTaxableGrowth = roundToCents(input.rothTaxableGrowth ?? 0);
  const rothTaxFreePortion = roundToCents(
    totalRothWithdrawal - rothTaxableGrowth,
  );

  const actualTaxableIncome =
    totalTraditionalWithdrawal + rothTaxableGrowth + taxableSS;
  const actualTraditionalRate =
    taxRates.taxBrackets && taxRates.taxBrackets.length > 0
      ? estimateEffectiveTaxRate(
          actualTaxableIncome,
          taxRates.taxBrackets,
          taxRates.taxMultiplier,
          taxRates.standardDeduction,
        )
      : taxRates.traditionalFallbackRate;

  // Basis-aware brokerage tax: only gains portion is taxable
  let brokerageTaxCost = 0;
  let brokerageBasisPortion = 0;
  let brokerageGainsPortion = 0;
  if (brokerageWithdrawal > 0 && balances.afterTax > 0) {
    const basisRatio = Math.min(1, balances.afterTaxBasis / balances.afterTax);
    brokerageBasisPortion = roundToCents(brokerageWithdrawal * basisRatio);
    brokerageGainsPortion = roundToCents(
      brokerageWithdrawal - brokerageBasisPortion,
    );
    // Progressive LTCG tax: stack gains on top of ordinary income across
    // 0%/15%/20% brackets. `actualTaxableIncome` is GROSS (correct for
    // `actualTraditionalRate` above, against the ordinary W-4 brackets) —
    // LTCG brackets are real taxable-income thresholds, so this call needs
    // the standard deduction subtracted first. See
    // `toLtcgTaxableIncome`'s docblock.
    brokerageTaxCost = filingStatus
      ? roundToCents(
          computeLtcgTax(
            toLtcgTaxableIncome(
              actualTaxableIncome,
              taxRates.standardDeduction,
            ),
            brokerageGainsPortion,
            filingStatus,
            taxRates.ltcgBrackets,
          ),
        )
      : roundToCents(brokerageGainsPortion * taxRates.brokerage);
  }

  const taxCost = roundToCents(
    totalTraditionalWithdrawal * actualTraditionalRate +
      rothTaxableGrowth * actualTraditionalRate +
      rothTaxFreePortion * taxRates.roth +
      hsaWithdrawal * taxRates.hsa +
      brokerageTaxCost,
  );

  return {
    taxCost,
    actualTraditionalRate,
    actualTaxableIncome,
    brokerageBasisPortion,
    brokerageGainsPortion,
    brokerageTaxCost,
    totalTraditionalWithdrawal,
    totalRothWithdrawal,
    hsaWithdrawal,
    brokerageWithdrawal,
    rothTaxableGrowth,
    rothTaxFreePortion,
    penaltyCost: roundToCents(input.penaltyCost ?? 0),
  };
}
