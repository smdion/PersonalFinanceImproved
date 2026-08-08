/**
 * Safe division — returns fallback when denominator is zero.
 * If fallback is null, returns null (caller must handle).
 * If fallback is a number, returns that number.
 * If fallback is omitted, returns 0.
 */
export function safeDivide(
  numerator: number,
  denominator: number,
  fallback?: number | null,
): number | null {
  if (denominator === 0) {
    return fallback === undefined ? 0 : fallback;
  }
  return numerator / denominator;
}

/**
 * Parse a form-field string into a positive integer, or null.
 *
 * `parseInt(x) || null` (the pattern this replaces) silently maps invalid
 * input, "0", and empty string all to `null` — but also lets negative
 * numbers AND trailing garbage straight through: `parseInt("-5") || null`
 * is `-5` (negative numbers are truthy), and `parseInt("3.7")`/
 * `parseInt("3months")` both stop at the first non-digit and return `3`.
 * Used for fields like "recur every N months" where anything that isn't
 * cleanly a positive integer should be rejected the same way as empty
 * input (null = "not set"), not silently truncated or accepted.
 */
export function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (n < 1) return null;
  return n;
}

/**
 * Round to cents (2 decimal places), half-away-from-zero.
 * Uses Math.abs + Math.sign to correctly handle negatives (credits, refunds,
 * negative cash flow). The EPSILON nudge avoids float multiplication bias at
 * .5-cent boundaries (e.g. 1.005 * 100 = 100.49999... in IEEE-754).
 */
export function roundToCents(value: number): number {
  // EPSILON * 100 scales the nudge to the cents space (~2.22e-14), large enough
  // to bridge the IEEE-754 float multiplication gap at .5-cent boundaries
  // (e.g. 1.005 * 100 = 100.49999...e-14, gap = 1.42e-14 < 2.22e-14).
  return (
    (Math.sign(value) *
      Math.round(Math.abs(value) * 100 + Number.EPSILON * 100)) /
    100
  );
}

/**
 * Sum an array of objects by a numeric property.
 */
export function sumBy<T>(items: T[], fn: (item: T) => number): number {
  return items.reduce((sum, item) => sum + fn(item), 0);
}

/**
 * Standard amortization formula: fixed monthly payment for a loan.
 * Returns 0 if principal is 0 or term is 0.
 */
export function calculateLoanMonthlyPayment(
  principal: number,
  annualRate: number,
  termYears: number,
): number {
  if (principal <= 0 || termYears <= 0) return 0;
  if (annualRate <= 0) return principal / (termYears * 12);
  const r = annualRate / 12;
  const n = termYears * 12;
  return (principal * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
}
