/**
 * Shared progressive-bracket tax accumulation, used by both tax.ts (annual
 * liability) and paycheck.ts (per-period withholding, via the IRS
 * annualized method). Consolidated per audit Batch 4 Finding 1 — both files
 * independently walked the same bracket structure summing tax per slice.
 *
 * Deliberately scoped to ONLY the tax-total accumulation. Marginal-rate
 * determination stays separate in each caller: tax.ts derives it as a
 * byproduct of this same walk (the last bracket with positive taxable
 * amount), while paycheck.ts needs a distinct highest-bracket-reached pass
 * (plus bracketMin/baseWithholding for the IRS withholding-table display)
 * that tax.ts has no use for — audit flagged these as "differently
 * structured," not interchangeable.
 */

export interface TaxBracket {
  min: number;
  max: number | null;
  rate: number;
}

export interface BracketTaxResult {
  /** Unrounded total tax — callers round as appropriate for their own display precision. */
  total: number;
  /** Rate of the last bracket that contributed a positive taxable slice (0 if none did). */
  marginalRate: number;
}

/**
 * Walks brackets bottom-to-top, summing tax on each slice of `income` that
 * falls within each bracket's [min, max) range.
 */
export function sumBracketTax(
  income: number,
  brackets: TaxBracket[],
): BracketTaxResult {
  let total = 0;
  let marginalRate = 0;
  for (const bracket of brackets) {
    if (income < bracket.min) break;
    const upper = bracket.max !== null ? Math.min(income, bracket.max) : income;
    const taxableInBracket = upper - bracket.min;
    if (taxableInBracket > 0) {
      total += taxableInBracket * bracket.rate;
      marginalRate = bracket.rate;
    }
  }
  return { total, marginalRate };
}
