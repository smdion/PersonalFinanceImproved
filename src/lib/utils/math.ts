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
 * Round to cents (2 decimal places) using standard half-up rounding.
 * Note: This is Math.round (half-up), not banker's rounding (half-to-even).
 * Validated by engine snapshot tests across 62 fixtures — any drift is caught.
 */
export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
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
