/**
 * Growth helpers for legally inflation-indexed federal tax thresholds —
 * ordinary tax brackets, the standard deduction, LTCG brackets, IRMAA
 * brackets, ACA FPL. Found live, 2026-08-31 ("outside the box" review of
 * engine-wide tax assumptions): every one of these is resolved once from a
 * single DB row / hardcoded config and held flat in NOMINAL dollars for
 * the entire 40-60 year projection, while the income/spending figures
 * compared against them correctly grow in nominal terms
 * (`pre-year-setup.ts`'s `* (1+inflationRate)^yearIndex` expense growth).
 * Confirmed against real production data: a household's Traditional
 * bracket-fill cap sat at exactly $133,000 in every year from 2044 to
 * 2083 while nominal spending need more than doubled over the same span —
 * the real purchasing power of "room in the bracket" collapsing purely
 * from a frozen comparison table.
 *
 * Deliberately does NOT cover NIIT's MAGI threshold or Social Security's
 * provisional-income taxation thresholds — both are genuinely fixed in
 * NOMINAL dollars by law (never inflation-indexed, IRC §1411(b) / IRC
 * §86 since 1984 respectively) and must stay flat. See `config/niit.ts`'s
 * header. Growing those would be the exact mistake this module's own
 * author already made and reverted earlier in the same session.
 *
 * Grows off the household's `inflationRate` — the same price index these
 * thresholds are legally indexed to — NOT `limitGrowthRate` (a separate,
 * independently-configurable rate specifically for IRS *contribution*
 * limits' own $500/$1,000 rounding-step indexing; using it here would
 * silently under-correct whenever the two rates differ, which they do by
 * default: `IRS_LIMIT_GROWTH_RATE` is 2%, general inflation defaults
 * higher).
 */
import type { WithholdingBracket } from "./tax-estimation";

/**
 * The exponent every grow* helper below expects: years between the
 * projection's current calendar `year` and the tax data's own vintage
 * (`taxDataYear` — see `DecumulationDefaults.distributionTaxRates.taxDataYear`'s
 * docblock, engine-config.ts, for why this is NOT the same as the
 * projection's `yearIndex`). Clamped to 0 — this data can't be "grown
 * backward" for a year before its own vintage.
 */
export function taxGrowthYears(
  year: number,
  taxDataYear: number | undefined,
): number {
  if (taxDataYear == null) return 0;
  return Math.max(0, year - taxDataYear);
}

/** `(1 + inflationRate) ^ taxGrowthYears(...)` — the one factor every
 *  grow* helper below applies. Compute ONCE per year and reuse across
 *  every threshold that needs it (RULES.md single-computation-path) —
 *  never derive it twice, and never grow `standardDeduction` and
 *  `taxBrackets` by two different factors: `toOrdinaryBracketIncome`'s
 *  residual math (`tax-estimation.ts`) is only scale-consistent when both
 *  share the identical factor. */
export function taxGrowthFactor(
  year: number,
  taxDataYear: number | undefined,
  inflationRate: number,
): number {
  return Math.pow(1 + inflationRate, taxGrowthYears(year, taxDataYear));
}

/** Scalar growth — the standard deduction, a single FPL cell, anything
 *  that's just one dollar figure. `undefined` in ⇒ `undefined` out
 *  (matches every existing "undefined ⇒ 0/unchanged" convention these
 *  values already have elsewhere in the engine). */
export function growAmount(
  base: number | undefined,
  growthFactor: number,
): number | undefined {
  if (base == null) return undefined;
  return base * growthFactor;
}

/**
 * Grows a W-4 withholding bracket table forward. Scales BOTH `threshold`
 * AND `baseWithholding` by the identical `growthFactor` — not `threshold`
 * alone. `estimateEffectiveTaxRate`'s real formula
 * (`tax-estimation.ts:101-107`) is
 * `tax = baseWithholding + (bracketIncome - threshold) * rate`; since
 * `baseWithholding` is itself `Σ rate_j·(threshold_{j+1} - threshold_j)`
 * — linear in the thresholds — scaling every threshold by `k` while
 * leaving `rate` alone makes the whole schedule homogeneous of degree 1:
 * `tax(k·x) = k·tax(x)`, so scaling `baseWithholding` by the same `k`
 * keeps every bracket's cumulative tax correct. Scaling `threshold`
 * without `baseWithholding` (or vice versa) computes wrong cumulative tax
 * at every bracket above the first — verified by direct derivation and
 * advisor review before this was written, not asserted on faith (see
 * this module's test file for the executable proof).
 */
export function growWithholdingBrackets(
  brackets: WithholdingBracket[],
  growthFactor: number,
): WithholdingBracket[] {
  return brackets.map((b) => ({
    threshold: b.threshold * growthFactor,
    baseWithholding: b.baseWithholding * growthFactor,
    rate: b.rate,
  }));
}
