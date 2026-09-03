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

/**
 * Convert Pub 15-T percentage-method withholding brackets (thresholds in
 * ADJUSTED-ANNUAL-WAGE space — Worksheet 1A's deduction already folded in,
 * already) into Form 1040 rate-schedule brackets (real TAXABLE-INCOME
 * space, i.e. post-standard-deduction). The two tables share identical
 * widths — Pub 15-T's standard percentage-method table is the 1040 rate
 * schedule shifted by exactly `standardDeduction - worksheet1AAdjustment`
 * (verified against IRS Rev. Proc. 2025-32 boundaries) — so they differ
 * only by a constant shift equal to the first non-zero bracket's threshold.
 *
 * Only valid for w4_checkbox=false (standard) rows — the 2(c) half-tables
 * are a withholding-only device with no 1040 analogue.
 */
export function toTaxableIncomeBrackets(brackets: TaxBracket[]): TaxBracket[] {
  const firstTaxed = brackets.findIndex((b) => b.rate > 0);
  if (firstTaxed < 0) return brackets;
  const offset = brackets[firstTaxed]!.min;
  return brackets.slice(firstTaxed).map((b) => ({
    min: b.min - offset,
    max: b.max === null ? null : b.max - offset,
    rate: b.rate,
  }));
}
