/**
 * Growth helpers for legally inflation-indexed federal tax thresholds —
 * ordinary tax brackets, the standard deduction, LTCG brackets, IRMAA
 * brackets. (ACA's 400%-FPL cliff is inflation-indexed too and gets the
 * same fix, but grown at its own single call site —
 * `checkAca`, `post-withdrawal-optimizer.ts` — via a `fplGrowthFactor`
 * multiplier rather than a `grow*` helper here.) An "outside the box" review
 * of engine-wide tax assumptions found that every one of these is resolved
 * once from a
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
import type { LtcgBracketTable } from "../../config/tax-tables";
import type { IrmaaBracketTable } from "../../config/irmaa-tables";

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

/** `(1 + inflationRate) ^ taxGrowthYears(...)` — the factor the grow*
 *  helpers below apply, one per table per year (RULES.md
 *  single-computation-path). Each table grows from its own year
 *  (`taxTableYears`); when `standardDeduction` and `taxBrackets` share a
 *  year they share the identical factor, and when they don't, each grown
 *  value still estimates year y's real figure, so
 *  `toOrdinaryBracketIncome`'s residual (`tax-estimation.ts`) stays
 *  correct. */
export function taxGrowthFactor(
  year: number,
  taxDataYear: number | undefined,
  inflationRate: number,
): number {
  return Math.pow(1 + inflationRate, taxGrowthYears(year, taxDataYear));
}

/** Scalar growth — the standard deduction, anything that's just one
 *  dollar figure. `undefined` in ⇒ `undefined` out (matches every
 *  existing "undefined ⇒ 0/unchanged" convention these values already
 *  have elsewhere in the engine). NOT used for the ACA FPL cliff — that
 *  grows via a `fplGrowthFactor` multiplier at `checkAca`'s point of use
 *  instead (see this file's header docblock for why). */
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
 * at every bracket above the first — verified by direct derivation
 * before this was written, not asserted on faith (see
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

/**
 * Grows LTCG brackets forward. Unlike `growWithholdingBrackets`, there's no
 * `baseWithholding`-equivalent cumulative shortcut to keep in sync —
 * `computeLtcgTax`/`getLtcgRate`/`ltcgRateForNextDollar`/`ltcgRoomForRate`
 * (`config/tax-tables.ts`) all walk the bracket list fresh from `threshold`
 * and `rate` alone every call, so scaling `threshold` (leaving `rate`
 * alone) is sufficient and self-consistent on its own.
 *
 * `threshold: null` (the stored open top bracket) stays `null` — do not
 * multiply it (`null * k` coerces to `0` in JS, silently turning the top
 * bracket into a $0 threshold).
 */
export function growLtcgBrackets(
  brackets: LtcgBracketTable,
  growthFactor: number,
): LtcgBracketTable {
  const source = brackets;
  const grown: LtcgBracketTable = {};
  for (const [filingStatus, entries] of Object.entries(source)) {
    grown[filingStatus] = entries.map((b) => ({
      threshold: b.threshold == null ? null : b.threshold * growthFactor,
      rate: b.rate,
    }));
  }
  return grown;
}

/**
 * Grows IRMAA brackets forward. Unlike LTCG, BOTH fields scale — not just
 * `magiThreshold`:
 *
 * - `magiThreshold` grows for the same reason every other threshold in
 *   this module does: it's a nominal dollar figure (this year's Medicare
 *   premium schedule) compared against a correctly-inflating MAGI, so
 *   holding it flat silently shrinks real headroom before the surcharge
 *   hits, same as every other threshold here.
 * - `annualSurcharge` growing is NOT the free/optional modeling choice
 *   it might look like (IRMAA is a cliff/step function — `getIrmaaCost`
 *   has no `baseWithholding`-style cumulative schedule, so there's no
 *   correctness constraint FORCING it to scale the way `baseWithholding`
 *   is forced to in `growWithholdingBrackets`). It scales here because
 *   `withdrawal-bracket-optimizer.ts`'s `netCost` sums `irmaaCost` into
 *   the SAME `lifetimeTax` total as `taxCost`/`rothConversionTaxCost` —
 *   values that, after Phases 1-2, are computed off correctly-grown
 *   brackets. Leaving `annualSurcharge` flat would silently shrink
 *   IRMAA's real weight in that objective relative to the now-grown tax
 *   terms, biasing the optimizer's target-bracket selection away from
 *   what it should be — a Phase-1/2-INDUCED distortion, not a pre-existing
 *   one. (Real Medicare Part B/D premiums have historically risen faster
 *   than general CPI; growing at `inflationRate` instead of a
 *   Medicare-specific rate — which doesn't exist anywhere in `src/lib/`
 *   today — is a known, deliberate conservatism, not an attempt at
 *   precision.)
 *
 * No `null` top-bracket special-casing needed (unlike LTCG) — every IRMAA
 * tier has a finite `magiThreshold`.
 */
export function growIrmaaBrackets(
  brackets: IrmaaBracketTable,
  growthFactor: number,
): IrmaaBracketTable {
  const source = brackets;
  const grown: IrmaaBracketTable = {};
  for (const [filingStatus, entries] of Object.entries(source)) {
    grown[filingStatus] = entries.map((b) => ({
      magiThreshold: b.magiThreshold * growthFactor,
      annualSurcharge: b.annualSurcharge * growthFactor,
    }));
  }
  return grown;
}

/**
 * The year each yearly tax table grows from — its own year when the caller
 * gives one, else the limits year (`taxDataYear`). A caller that threads no
 * years at all (`taxDataYear` undefined) means "treat the tax data as
 * current": no growth, for every table alike.
 */
export function taxTableYears(taxRates: {
  taxDataYear?: number;
  taxBracketsYear?: number;
  ltcgBracketsYear?: number;
  irmaaBracketsYear?: number;
  fplYear?: number;
}): {
  standardDeduction: number | undefined;
  brackets: number | undefined;
  ltcg: number | undefined;
  irmaa: number | undefined;
  fpl: number | undefined;
} {
  const y = taxRates.taxDataYear;
  const own = (year: number | undefined) =>
    y === undefined ? undefined : (year ?? y);
  return {
    standardDeduction: y,
    brackets: own(taxRates.taxBracketsYear),
    ltcg: own(taxRates.ltcgBracketsYear),
    irmaa: own(taxRates.irmaaBracketsYear),
    fpl: own(taxRates.fplYear),
  };
}
