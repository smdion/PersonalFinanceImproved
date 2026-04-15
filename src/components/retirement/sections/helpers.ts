/**
 * Shared helpers for retirement section components.
 *
 * Extracted in v0.5.3 (Group E refactor) — previously duplicated in
 * income.tsx and raise-and-rate.tsx with a comment noting the dupe.
 */

/** Convert a decimal string (e.g. '0.04') to a whole-number string for display ('4'). */
export function decToWhole(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return "0";
  return String(Math.round(n * 10000) / 100); // 0.04 → 4
}
