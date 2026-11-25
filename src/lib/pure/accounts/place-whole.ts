import { roundToCents, sumBy } from "@/lib/utils/math";

/** An uncapped spread placed whole: each member its `raw` amount to the cent, the largest share
 *  (the earlier on a tie) the cents left, over or under, so no member ends more than (n − 1)/2
 *  cents from its raw amount. Draws capped at each part's balance keep their own room rule. */
export function placeWhole(amount: number, raw: readonly number[]): number[] {
  const placed = raw.map((r) => roundToCents(r));
  if (placed.length === 0) return placed;
  const largest = raw.reduce((best, r, i) => (r > raw[best]! ? i : best), 0);
  const others = sumBy(placed, (share) => share) - placed[largest]!;
  placed[largest] = roundToCents(amount - others);
  return placed;
}
