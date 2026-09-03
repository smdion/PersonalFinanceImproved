/**
 * Shared helpers for retirement section components.
 *
 * Previously duplicated in income.tsx and raise-and-rate.tsx.
 */

/** Convert a decimal string (e.g. '0.04') to a whole-number string for display ('4'). */
export function decToWhole(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return "0";
  return String(Math.round(n * 10000) / 100); // 0.04 → 4
}

/** Convert a whole-number string (e.g. '4') to a decimal string for storage ('0.04'). */
export function wholeToDec(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return "0";
  return String(Math.round(n * 100) / 10000); // 4 → 0.04
}
