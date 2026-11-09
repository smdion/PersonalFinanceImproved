/**
 * Tax estimation: W-4 effective rate, bracket caps for bracket-filling, taxable SS and the tax of
 * routed slots. The SS gross-up loop lives in withdrawal-solver.ts to avoid an import cycle.
 */
import type { TaxBuckets } from "../accounts/account-balances.types";
import type { DecumulationSlot } from "./types/routing";
import { roundToCents, sumBy } from "../../utils/math";
import {
  getAccountTypeConfig,
  isOverflowTarget,
} from "../../config/account-types";
import { computeLtcgTax, toLtcgTaxableIncome } from "@/lib/pure/tax/ltcg";
import { MAX_EFFECTIVE_TAX_RATE } from "../../constants";
import {
  ssTaxThresholdsFor,
  SS_TAX_TIER1_INCLUSION_RATE,
  SS_TAX_TIER2_INCLUSION_RATE,
} from "../../config/ss-tax";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

// ---------------------------------------------------------------------------
// Tax bracket estimator — computes effective tax rate on traditional withdrawals
// ---------------------------------------------------------------------------

export type WithholdingBracket = {
  threshold: number;
  baseWithholding: number;
  rate: number;
};

/**
 * Gross ordinary income → the adjusted wage the Pub 15-T table is denominated in: minus
 * (standardDeduction − first non-zero threshold), Worksheet 1A line 1g. Shifts income, not
 * thresholds (baseWithholding depends on them). Undefined `standardDeduction` returns gross.
 */
function toOrdinaryBracketIncome(
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
 * Effective federal rate on taxable income (Traditional + taxable SS) from W-4 brackets, scaled
 * by `taxMultiplier`. Pass `standardDeduction` to subtract the Worksheet 1A residual the brackets
 * omit (else overstated). The rate is against GROSS income, as callers multiply it back.
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
 * Largest gross income within `targetRate`: the first higher bracket's threshold plus the
 * Worksheet 1A residual, used as a gross withdrawal cap. Infinity when no bracket exceeds it.
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

/** @internal Only tests import it (knip --production).
 * The rate of the bracket above `targetRate`'s ceiling (prices non-qualified Roth growth stacked
 * on a filled bracket); `targetRate` itself when no bracket exceeds it. */
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
 * Marginal ordinary rate for the next dollar at `income` (dollar-based, unlike
 * `marginalRateAboveTarget`). 0 for income ≤ 0 or no brackets; `standardDeduction` applies the
 * Worksheet 1A residual, so income under the full deduction gets 0%.
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

/**
 * Taxable Social Security by the IRS 3-tier provisional income formula (other income + half of
 * SS + tax-exempt interest): 0% below tier 1, up to 50% to tier 2, up to 85% above.
 */
export function computeTaxableSS(
  ssIncome: number,
  otherTaxableIncome: number,
  filingStatus: ReturnFilingStatus,
  taxExemptInterest: number = 0,
): number {
  if (ssIncome <= 0) return 0;

  const thresholds = ssTaxThresholdsFor(filingStatus);
  if (!thresholds) return ssIncome * SS_TAX_TIER2_INCLUSION_RATE; // fallback

  // IRS Pub 915: provisional income includes tax-exempt interest (e.g. municipal bonds)
  const provisionalIncome =
    otherTaxableIncome +
    SS_TAX_TIER1_INCLUSION_RATE * ssIncome +
    taxExemptInterest;

  if (provisionalIncome <= thresholds.tier1) {
    return 0;
  }

  // Tier 1 → Tier 2: up to 50% of SS is taxable
  const tier1Excess = Math.min(
    provisionalIncome - thresholds.tier1,
    thresholds.tier2 - thresholds.tier1,
  );
  let taxable = Math.min(
    SS_TAX_TIER1_INCLUSION_RATE * tier1Excess,
    SS_TAX_TIER1_INCLUSION_RATE * ssIncome,
  );

  // Above tier 2: up to 85% of SS is taxable
  if (provisionalIncome > thresholds.tier2) {
    const tier2Excess = provisionalIncome - thresholds.tier2;
    taxable = Math.min(
      taxable + SS_TAX_TIER2_INCLUSION_RATE * tier2Excess,
      SS_TAX_TIER2_INCLUSION_RATE * ssIncome,
    );
  }

  return roundToCents(Math.max(0, taxable));
}

/**
 * Taxable SS for a priced year: provisional income counts Traditional withdrawals, non-qualified
 * Roth growth and realized gains (IRS Pub 915). A Roth conversion runs after pricing and isn't
 * included (see TODO).
 */
export function taxableSSFor(
  ssIncome: number,
  priced: Pick<
    ComputeTaxFromSlotsResult,
    "totalTraditionalWithdrawal" | "rothTaxableGrowth" | "brokerageGainsPortion"
  >,
  filingStatus: ReturnFilingStatus,
): number {
  return computeTaxableSS(
    ssIncome,
    priced.totalTraditionalWithdrawal +
      priced.rothTaxableGrowth +
      priced.brokerageGainsPortion,
    filingStatus,
  );
}

// ---------------------------------------------------------------------------
// Tax cost from a completed set of withdrawal slots
// ---------------------------------------------------------------------------

interface ComputeTaxFromSlotsInput {
  /** The routed withdrawal, from any of withdrawal-routing/'s route*
   *  functions — real execution or a candidate estimate, this function
   *  doesn't care which. */
  slots: DecumulationSlot[];
  /** Taxable Social Security for this year (already resolved by the caller). */
  taxableSS: number;
  /** Current balances by tax bucket — only afterTax/afterTaxBasis are read,
   *  for the brokerage basis-ratio split. */
  balances: Pick<TaxBuckets, "afterTax" | "afterTaxBasis">;
  /** The basis ratio of the brokerage money withdrawn (the Retirement
   *  brokerages' own, brokerage-basis.ts) — one ratio per year shared with
   *  the ranking. Omitted: the aggregate ratio from `balances`. */
  brokerageBasisRatio?: number;
  /** Authoritative totals when the caller already tracks them (post-RMD in decumulation-year.ts),
   *  so no sub-cent drift from re-summing. Omit to derive from slots (withdrawal-solver.ts). */
  totalTraditionalWithdrawal?: number;
  totalRothWithdrawal?: number;
  /** Growth in non-qualified Roth distributions this year (`splitRothWithdrawalForTax`):
   *  ordinary income. 0 taxes the whole Roth withdrawal at `taxRates.roth`. */
  rothTaxableGrowth: number;
  /** Early-withdrawal penalty (`computeEarlyWithdrawalPenalty`): an excise, kept out of
   *  `actualTaxableIncome` and `taxCost` (which mean income tax only). */
  penaltyCost: number;
  /** The brokerage withdrawal's tax when the caller has re-priced it (the
   *  post-conversion recompute in decumulation-year.ts, where a Roth
   *  conversion raised the LTCG stacking base). Omitted: computed here. */
  brokerageTaxCostOverride?: number;
  taxRates: {
    traditionalFallbackRate: number;
    roth: number;
    hsa: number;
    brokerage: number;
    taxBrackets?: WithholdingBracket[];
    taxMultiplier?: number;
    ltcgBrackets: Record<string, { threshold: number | null; rate: number }[]>;
    /** Converts `actualTaxableIncome` (gross) to the taxable income the LTCG
     *  lookup below uses (`toLtcgTaxableIncome`); omitted subtracts nothing. */
    standardDeduction?: number;
  };
  filingStatus: ReturnFilingStatus | null | undefined;
}

interface ComputeTaxFromSlotsResult {
  taxCost: number;
  actualTraditionalRate: number;
  /** `totalTraditionalWithdrawal + rothTaxableGrowth + taxableSS`: this year's ordinary income
   *  before LTCG stacking. Read this rather than re-deriving it. */
  actualTaxableIncome: number;
  /** Return-of-basis portion of the brokerage withdrawal (tax-free). Caller
   *  is responsible for annotating the brokerage slot with this if needed —
   *  this function only reads slots, it doesn't mutate them. */
  brokerageBasisPortion: number;
  /** Taxable-gains portion of the brokerage withdrawal. */
  brokerageGainsPortion: number;
  /** Tax on the brokerage withdrawal alone (subset of taxCost), exposed so callers don't
   *  re-derive it from rounded components. */
  brokerageTaxCost: number;
  /** Tax on taxable Social Security (subset of taxCost) at the withdrawals' average ordinary rate.
   *  Owed regardless of withdrawals, so `withdrawalTaxCost` leaves it out. */
  ssTaxCost: number;
  totalTraditionalWithdrawal: number;
  totalRothWithdrawal: number;
  hsaWithdrawal: number;
  brokerageWithdrawal: number;
  /** Echoes `input.rothTaxableGrowth` — the portion of
   *  `totalRothWithdrawal` taxed as ordinary income this year. */
  rothTaxableGrowth: number;
  /** `totalRothWithdrawal - rothTaxableGrowth`, taxed at `taxRates.roth` (0 by default); exposed
   *  so callers don't re-derive a rounded component. */
  rothTaxFreePortion: number;
  /** Echoes `input.penaltyCost`. NOT included in `taxCost`
   *  — a separate output field for the same reason it's a separate input
   *  (see `ComputeTaxFromSlotsInput.penaltyCost`'s docblock). */
  penaltyCost: number;
}

/**
 * Tax cost of a routed set of slots: one path for the real year and withdrawal-solver.ts's
 * estimateWithdrawalTaxCost loop.
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
  // Non-qualified Roth growth is ordinary income: it enters
  // actualTaxableIncome before bracket/LTCG stacking.
  const rothTaxableGrowth = roundToCents(input.rothTaxableGrowth);
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
  if (input.brokerageTaxCostOverride !== undefined) {
    brokerageTaxCost = roundToCents(input.brokerageTaxCostOverride);
    if (brokerageWithdrawal > 0 && balances.afterTax > 0) {
      const basisRatio =
        input.brokerageBasisRatio ??
        Math.min(1, balances.afterTaxBasis / balances.afterTax);
      brokerageBasisPortion = roundToCents(brokerageWithdrawal * basisRatio);
      brokerageGainsPortion = roundToCents(
        brokerageWithdrawal - brokerageBasisPortion,
      );
    }
  } else if (brokerageWithdrawal > 0 && balances.afterTax > 0) {
    const basisRatio =
      input.brokerageBasisRatio ??
      Math.min(1, balances.afterTaxBasis / balances.afterTax);
    brokerageBasisPortion = roundToCents(brokerageWithdrawal * basisRatio);
    brokerageGainsPortion = roundToCents(
      brokerageWithdrawal - brokerageBasisPortion,
    );
    // Progressive LTCG tax: gains stack on ordinary income across 0%/15%/20%.
    // `actualTaxableIncome` is gross (right for the W-4 brackets above), so
    // it becomes taxable income for the LTCG brackets first.
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

  // Taxable Social Security is ordinary income too: the rate above is the
  // average over all of it, so its share is owed at that rate. (With no
  // brackets, the flat fallback rate — 0 in simple tax mode.)
  const ssTaxCost = roundToCents(taxableSS * actualTraditionalRate);
  const taxCost = roundToCents(
    totalTraditionalWithdrawal * actualTraditionalRate +
      rothTaxableGrowth * actualTraditionalRate +
      rothTaxFreePortion * taxRates.roth +
      hsaWithdrawal * taxRates.hsa +
      brokerageTaxCost +
      ssTaxCost,
  );

  return {
    taxCost,
    actualTraditionalRate,
    actualTaxableIncome,
    brokerageBasisPortion,
    brokerageGainsPortion,
    brokerageTaxCost,
    ssTaxCost,
    totalTraditionalWithdrawal,
    totalRothWithdrawal,
    hsaWithdrawal,
    brokerageWithdrawal,
    rothTaxableGrowth,
    rothTaxFreePortion,
    penaltyCost: roundToCents(input.penaltyCost),
  };
}
