/**
 * Palette index → color for the analytics allocation charts and their legend
 * swatches. Its own dependency-free module so `analytics-content.tsx` can
 * import it statically without pulling in `analytics-charts.tsx` (and its
 * Recharts payload, which is meant to be `next/dynamic`'d).
 */
import { EXPENSE_PIE_COLORS } from "@/lib/utils/colors";

export function sliceColor(i: number) {
  return EXPENSE_PIE_COLORS[i % EXPENSE_PIE_COLORS.length]!;
}
