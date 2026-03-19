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
 * Round to cents (2 decimal places) using banker's rounding.
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
