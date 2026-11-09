/**
 * Progressive-bracket tax accumulation for tax.ts (annual liability) and per-check.ts (annualized
 * withholding). Tax total only: each caller finds its marginal rate its own way.
 */

interface TaxBracket {
  min: number;
  max: number | null;
  rate: number;
}

interface BracketTaxResult {
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
 * Pub 15-T percentage-method brackets (adjusted-annual-wage space) to Form 1040 taxable-income
 * brackets: the same widths shifted by the first non-zero threshold. Only for w4_checkbox=false
 * rows; the 2(c) half-tables have no 1040 analogue.
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
