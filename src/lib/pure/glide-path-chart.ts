/**
 * The glide-path chart's data: the target mix by age (the same
 * interpolation the targets use) and Vanguard's target-date stock share
 * shifted to the household's retirement age. Pure.
 */
import { interpolateAllocations } from "@/lib/calculators/random";
import { VANGUARD_TDF_STOCK_SHARE } from "@/lib/config/benchmarks";

export type GlidePathPoint = {
  age: number;
  allocations: Record<number, number>;
};

/** One row per age: each asset class's share, as a fraction. */
export function glidePathSeries(
  path: readonly GlidePathPoint[],
  fromAge: number,
  toAge: number,
): { age: number; shares: Record<number, number> }[] {
  if (path.length === 0 || toAge < fromAge) return [];
  const sorted = [...path].sort((a, b) => a.age - b.age);
  const out: { age: number; shares: Record<number, number> }[] = [];
  for (let age = fromAge; age <= toAge; age++)
    out.push({ age, shares: interpolateAllocations(sorted, age) });
  return out;
}

/** Vanguard Target Retirement's stock share at an age, for a household
 *  retiring at `retirementAge`. */
export function vanguardStockShare(age: number, retirementAge: number): number {
  const years = retirementAge - age;
  const points = VANGUARD_TDF_STOCK_SHARE;
  if (years >= points[0]!.yearsToRetirement) return points[0]!.stockShare;
  const last = points[points.length - 1]!;
  if (years <= last.yearsToRetirement) return last.stockShare;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (years <= a.yearsToRetirement && years >= b.yearsToRetirement) {
      const t =
        (a.yearsToRetirement - years) /
        (a.yearsToRetirement - b.yearsToRetirement);
      return a.stockShare + t * (b.stockShare - a.stockShare);
    }
  }
  return last.stockShare;
}
