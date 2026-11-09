/**
 * Grows inflation-indexed federal tax thresholds (brackets, standard deduction, LTCG, IRMAA) by
 * `inflationRate`, not `limitGrowthRate`. NIIT and SS provisional-income thresholds are fixed
 * nominal by law (IRC §1411(b), §86) and stay flat; the ACA cliff grows in `checkAca`.
 */
import type { WithholdingBracket } from "./tax-estimation";
import type { LtcgBracketTable } from "../../config/tax-tables";
import type { IrmaaBracketTable } from "../../config/irmaa-tables";

/**
 * Years from the tax data's vintage (`taxDataYear`, not the projection's `yearIndex`) to `year`,
 * the exponent the grow* helpers expect. Clamped at 0: data never grows backward.
 */
export function taxGrowthYears(
  year: number,
  taxDataYear: number | undefined,
): number {
  if (taxDataYear == null) return 0;
  return Math.max(0, year - taxDataYear);
}

/** `(1 + inflationRate) ^ taxGrowthYears(...)`: a plain run's factor for the grow* helpers
 *  (a Simulation trial's comes from inflation-path.ts `growthSinceVintage`). Each table grows
 *  from its own year (`taxTableYears`). */
export function taxGrowthFactor(
  year: number,
  taxDataYear: number | undefined,
  inflationRate: number,
): number {
  return Math.pow(1 + inflationRate, taxGrowthYears(year, taxDataYear));
}

/** Scalar growth (e.g. the standard deduction); `undefined` in, `undefined` out. */
export function growAmount(
  base: number | undefined,
  growthFactor: number,
): number | undefined {
  if (base == null) return undefined;
  return base * growthFactor;
}

/**
 * Grows W-4 brackets: scales `threshold` and `baseWithholding` by the same factor, since tax is
 * homogeneous of degree 1 in the thresholds; scaling only one breaks every upper bracket.
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
 * Grows LTCG brackets: only `threshold` scales (`tax/ltcg.ts` walks the list fresh each call).
 * The open top bracket's `null` stays `null` (`null * k` would be 0).
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
 * Grows IRMAA brackets: `magiThreshold` and `annualSurcharge` both scale, so the surcharge keeps
 * its weight against grown tax terms in the bracket optimizer's `lifetimeTax`. Every tier has a
 * finite threshold.
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
 * The year each tax table grows from: its own year when given, else `taxDataYear`. No years at
 * all (`taxDataYear` undefined) means the data is current: no growth.
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
