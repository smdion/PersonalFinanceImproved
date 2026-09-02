// Long-Term Capital Gains tax brackets by filing status.
// Source: IRS Revenue Procedure 2025-32 (2026 tax year, adjusted annually).
//
// Key: LTCG brackets use total taxable income (ordinary + capital gains),
// NOT just capital gains alone.

import type { FilingStatusType } from "../calculators/types";

/** LTCG bracket entry — rate applies to gains when total taxable income is below threshold. */
type LtcgBracket = { threshold: number; rate: number };

/**
 * Convert GROSS ordinary income (Traditional withdrawals + taxable SS +
 * non-qualified Roth growth + Roth conversions, before any deduction) into
 * the TAXABLE ordinary income LTCG brackets are actually denominated in.
 *
 * Found 2026-08-30: every LTCG-stacking call site in the engine
 * (`withdrawal-cost-ranking.ts`'s Tier 1 0%-room calc, `tax-estimation.ts`'s
 * `computeTaxFromSlots`, `decumulation-year.ts`'s Roth-conversion-revised
 * LTCG recompute) fed `LTCG_BRACKETS`/`ltcgBrackets` a gross figure with
 * nothing subtracted. LTCG brackets use real IRS taxable-income thresholds
 * (see this file's header) — gross income sits ABOVE the true stacking
 * floor by roughly the household's standard deduction, so every one of
 * those call sites systematically understated 0%/15% LTCG room and
 * overcharged real capital-gains tax. Single conversion point so all of
 * them apply the exact same correction — RULES.md's single-computation-path
 * rule applies here same as anywhere else; fixing only one call site would
 * leave withdrawal ROUTING and the actual TAX CHARGE disagreeing about how
 * much 0% room existed.
 *
 * Deliberately NOT used for the ordinary W-4 withholding brackets
 * (`incomeCapForMarginalRate`/`estimateEffectiveTaxRate`/`marginalRateAtIncome`
 * in `tax-estimation.ts`) — those already embed a (different, smaller) Pub
 * 15-T Worksheet 1A offset in their own threshold scale, so subtracting the
 * FULL standard deduction there would double-count. They have their own,
 * separate correction (`toOrdinaryBracketIncome`, R56) that subtracts only
 * the residual between the two — do not "consolidate" the two helpers, the
 * bracket shapes they operate on (`TaxBracket{min,max,rate}` here vs.
 * `WithholdingBracket{threshold,baseWithholding,rate}` there) aren't
 * interchangeable (advisor review, 2026-08-30).
 *
 * `standardDeduction` omitted/undefined ⇒ subtracts 0, reproducing the
 * pre-fix (bugged) behavior exactly — every caller must pass a real
 * filing-status-keyed deduction (`distributionTaxRates.standardDeduction`,
 * sourced from `contribution_limits`) to actually get the correction; this
 * default keeps the fix additive rather than a forced behavior change for
 * any caller that hasn't been updated to supply it.
 *
 * Both the IRC §63(f)(1) age-65+ additional standard deduction (R59,
 * v0.7.11) and the temporary OBBBA senior deduction (2025-2028, v0.7.11
 * follow-on) ARE modeled as of this version: `decumulation-year.ts` folds
 * both into the deduction before growth, so the `standardDeduction` this
 * helper receives from a decumulation year is already senior-adjusted for
 * both. See `obbba-senior-deduction.ts`'s docblock for the OBBBA mechanism
 * (MAGI-phased, sunset-gated, uses last year's MAGI as the phaseout basis —
 * decumulation year 1 gets $0 OBBBA deduction, no prior-year MAGI exists
 * yet).
 */
export function toLtcgTaxableIncome(
  grossOrdinaryIncome: number,
  standardDeduction: number | undefined,
): number {
  return Math.max(0, grossOrdinaryIncome - (standardDeduction ?? 0));
}

/** 2026 LTCG brackets by filing status (thresholds adjusted annually for inflation). */
export const LTCG_BRACKETS: Record<FilingStatusType, LtcgBracket[]> = {
  MFJ: [
    { threshold: 98900, rate: 0 },
    { threshold: 613700, rate: 0.15 },
    { threshold: Infinity, rate: 0.2 },
  ],
  Single: [
    { threshold: 49450, rate: 0 },
    { threshold: 545500, rate: 0.15 },
    { threshold: Infinity, rate: 0.2 },
  ],
  HOH: [
    { threshold: 66200, rate: 0 },
    { threshold: 579600, rate: 0.15 },
    { threshold: Infinity, rate: 0.2 },
  ],
};

/**
 * Get the effective LTCG tax rate based on total taxable income and filing status.
 * Uses the income level (ordinary + gains) to determine which LTCG bracket applies.
 *
 * For simplicity, returns a single rate (the marginal rate at the given income level).
 * A blended rate would be more accurate for large gains spanning brackets, but the
 * single-rate approximation is sufficient for projection purposes.
 *
 * @param dbBrackets Optional DB-loaded brackets (overrides hardcoded defaults).
 *                   Thresholds use null for Infinity (top bracket).
 */
export function getLtcgRate(
  totalTaxableIncome: number,
  filingStatus: FilingStatusType,
  dbBrackets?: Record<string, { threshold: number | null; rate: number }[]>,
): number {
  // Use DB brackets if provided, falling back to hardcoded defaults
  const raw = dbBrackets
    ? dbBrackets[filingStatus]
    : LTCG_BRACKETS[filingStatus];
  if (!raw) return 0.15; // fallback
  // Normalize null thresholds to Infinity (DB stores null for top bracket)
  const brackets = raw.map((b) => ({
    threshold: b.threshold ?? Infinity,
    rate: b.rate,
  }));
  for (const b of brackets) {
    if (totalTaxableIncome <= b.threshold) return b.rate;
  }
  return 0.2; // above all thresholds
}

/**
 * The LTCG rate that applies to the NEXT dollar above `taxableIncome` — the
 * exclusive counterpart to `getLtcgRate`. Use when pricing a slice of gains
 * that STARTS at a given income level, notably one landing exactly on
 * another bracket's own ceiling (as `ltcgRoomForRate` computes by
 * construction — `zeroGainsRoom`'s callers add it back onto ordinary
 * income to price the tier beyond it). `getLtcgRate`'s inclusive `<=`
 * answers a different, also-correct question — "what bracket is a real
 * dollar SITTING AT" (income exactly at the 0% ceiling genuinely IS taxed
 * at 0%) — and returning the bracket BELOW for a "what's next" query
 * silently under-prices that entire next tier (found 2026-08-31: this
 * exact substitution mispriced brokerage as 0%/NIIT-only well past its
 * real 15% rate for any household whose ordinary income left room in the
 * 0% zone, causing `rankWithdrawalTiers` to disagree with the real tax
 * charge `computeLtcgTax` correctly applies — RULES.md single-computation-
 * path). Both functions are correct for their own question; do not
 * consolidate them.
 *
 * Deliberately NOT a rate-keyed "next bracket above targetRate" walk (that
 * approach was tried and rejected — it returns a flat 0.15 for every
 * income level, silently under-pricing a household already past the 15%
 * ceiling too, who should get 0.20). Same single-rate-per-tier
 * approximation as `getLtcgRate` otherwise (a tier spanning 15% into 20%
 * still prices entirely at whichever bracket the START of that tier
 * lands in) — acceptable for ordering, not exact-cent pricing.
 */
export function ltcgRateForNextDollar(
  taxableIncome: number,
  filingStatus: FilingStatusType,
  dbBrackets?: Record<string, { threshold: number | null; rate: number }[]>,
): number {
  const raw = dbBrackets
    ? dbBrackets[filingStatus]
    : LTCG_BRACKETS[filingStatus];
  if (!raw) return 0.15; // fallback
  for (const b of raw) {
    if (taxableIncome < (b.threshold ?? Infinity)) return b.rate;
  }
  return 0.2; // above all thresholds
}

/**
 * Compute progressive LTCG tax by stacking capital gains on top of ordinary income.
 *
 * LTCG brackets are based on total taxable income (ordinary + gains). Gains sit on
 * top of ordinary income in the bracket stack, so low-income filers may have some
 * gains in the 0% bracket even if they also have gains in the 15% bracket.
 *
 * Example (MFJ 2026, thresholds $98,900 / $613,700):
 *   ordinary = $80,000, gains = $30,000
 *   → $18,900 of gains taxed at 0% (fills up to $98,900)
 *   → $11,100 of gains taxed at 15%
 *   → total tax = $1,665  (vs. flat 15% × $30k = $4,500)
 *
 * @returns The total LTCG tax amount (not a rate).
 */
export function computeLtcgTax(
  ordinaryTaxableIncome: number,
  capitalGains: number,
  filingStatus: FilingStatusType,
  dbBrackets?: Record<string, { threshold: number | null; rate: number }[]>,
): number {
  if (capitalGains <= 0) return 0;

  const raw = dbBrackets
    ? dbBrackets[filingStatus]
    : LTCG_BRACKETS[filingStatus];
  if (!raw) return capitalGains * 0.15; // fallback

  const brackets = raw.map((b) => ({
    threshold: b.threshold ?? Infinity,
    rate: b.rate,
  }));

  let tax = 0;
  let gainsRemaining = capitalGains;
  // "floor" is the bottom of the current bracket segment for gains
  let floor = Math.max(0, ordinaryTaxableIncome);

  for (const b of brackets) {
    if (gainsRemaining <= 0) break;
    if (floor >= b.threshold) continue; // ordinary income already past this bracket

    const room = b.threshold - floor;
    const taxable = Math.min(gainsRemaining, room);
    tax += taxable * b.rate;
    gainsRemaining -= taxable;
    floor += taxable;
  }

  return Math.round(tax * 100) / 100; // round to cents
}

/**
 * How much LTCG headroom remains before crossing above `targetRate`, given
 * ordinary taxable income already occupying the bottom of the stack.
 *
 * NOT a reuse of `incomeCapForMarginalRate` (ordinary W-4 brackets) — the
 * two tables use opposite threshold semantics. Ordinary brackets store the
 * bracket's floor (matched with `>=` in `estimateEffectiveTaxRate`); LTCG
 * brackets store the bracket's ceiling (matched with `<=` in `getLtcgRate`
 * above). Casting one against the other silently returns the wrong number
 * (verified: overstates MFJ 0%-LTCG headroom by $514,800) — this function
 * exists so nothing needs to make that mistake.
 */
export function ltcgRoomForRate(
  targetRate: number,
  ordinaryTaxableIncome: number,
  filingStatus: FilingStatusType,
  dbBrackets?: Record<string, { threshold: number | null; rate: number }[]>,
): number {
  const raw = dbBrackets
    ? dbBrackets[filingStatus]
    : LTCG_BRACKETS[filingStatus];
  if (!raw) return 0;
  const brackets = raw.map((b) => ({
    threshold: b.threshold ?? Infinity,
    rate: b.rate,
  }));
  for (const b of brackets) {
    // LTCG brackets store the bracket's OWN ceiling (unlike ordinary
    // brackets, which store the NEXT bracket's floor) — so the room for
    // staying AT `targetRate` is that bracket's own threshold, found via
    // `>=` (the first bracket whose rate reaches targetRate), not `>`.
    if (b.rate >= targetRate) {
      return Math.max(0, b.threshold - ordinaryTaxableIncome);
    }
  }
  return Infinity;
}
