/**
 * Shared helpers for retirement section components.
 *
 * Previously duplicated in income.tsx and raise-and-rate.tsx.
 */
import { DEFAULT_ROTH_BRACKET_TARGET } from "@/lib/constants";

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

/** A stored Roth bracket target as a number: null or undefined gives the
 *  default; an empty string gives 0, as `Number("")` does. */
export function rothTargetOf(stored: string | null | undefined): number {
  return Number(stored ?? DEFAULT_ROTH_BRACKET_TARGET);
}
