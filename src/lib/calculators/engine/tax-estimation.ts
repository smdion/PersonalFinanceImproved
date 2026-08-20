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
import { computeLtcgTax } from "../../config/tax-tables";
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
 * Estimate effective federal income tax rate on traditional retirement withdrawals.
 * Uses W-4 withholding brackets (which embed the standard deduction in the 0% bracket).
 *
 * @param taxableIncome - Total taxable income (traditional withdrawals + taxable SS)
 * @param brackets - W-4 withholding brackets (from tax_brackets table), sorted by threshold ascending
 * @param taxMultiplier - Scales the computed tax (1.0 = current law, 1.2 = 20% higher, etc.)
 * @returns Effective tax rate as decimal (e.g. 0.14 = 14%)
 */
export function estimateEffectiveTaxRate(
  taxableIncome: number,
  brackets: WithholdingBracket[],
  taxMultiplier: number = 1.0,
): number {
  if (taxableIncome <= 0 || brackets.length === 0) return 0;

  // Find the applicable bracket
  let tax = 0;
  for (let i = brackets.length - 1; i >= 0; i--) {
    const b = brackets[i]!;
    if (taxableIncome >= b.threshold) {
      tax = b.baseWithholding + (taxableIncome - b.threshold) * b.rate;
      break;
    }
  }

  tax *= taxMultiplier;
  return Math.min(tax / taxableIncome, MAX_EFFECTIVE_TAX_RATE); // cap sanity check
}

/**
 * Find the maximum taxable income that stays within a target marginal rate.
 * Returns the threshold of the first bracket whose rate exceeds the target.
 * If no bracket exceeds the target, returns Infinity (no cap needed).
 */
export function incomeCapForMarginalRate(
  targetRate: number,
  brackets: WithholdingBracket[],
): number {
  for (const b of brackets) {
    if (b.rate > targetRate) return b.threshold;
  }
  return Infinity;
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
  taxRates: {
    traditionalFallbackRate: number;
    roth: number;
    hsa: number;
    brokerage: number;
    taxBrackets?: WithholdingBracket[];
    taxMultiplier?: number;
  };
  filingStatus: FilingStatusType | null | undefined;
}

export interface ComputeTaxFromSlotsResult {
  taxCost: number;
  actualTraditionalRate: number;
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

  const actualTaxableIncome = totalTraditionalWithdrawal + taxableSS;
  const actualTraditionalRate =
    taxRates.taxBrackets && taxRates.taxBrackets.length > 0
      ? estimateEffectiveTaxRate(
          actualTaxableIncome,
          taxRates.taxBrackets,
          taxRates.taxMultiplier,
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
    // Progressive LTCG tax: stack gains on top of ordinary income across 0%/15%/20% brackets
    brokerageTaxCost = filingStatus
      ? roundToCents(
          computeLtcgTax(
            actualTaxableIncome,
            brokerageGainsPortion,
            filingStatus,
          ),
        )
      : roundToCents(brokerageGainsPortion * taxRates.brokerage);
  }

  const taxCost = roundToCents(
    totalTraditionalWithdrawal * actualTraditionalRate +
      totalRothWithdrawal * taxRates.roth +
      hsaWithdrawal * taxRates.hsa +
      brokerageTaxCost,
  );

  return {
    taxCost,
    actualTraditionalRate,
    brokerageBasisPortion,
    brokerageGainsPortion,
    brokerageTaxCost,
    totalTraditionalWithdrawal,
    totalRothWithdrawal,
    hsaWithdrawal,
    brokerageWithdrawal,
  };
}
