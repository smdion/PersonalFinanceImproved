/**
 * Pure business logic for Monte Carlo projection calculations.
 * No DB or I/O dependency.
 */
import { geometricMean } from "@/lib/calculators/random";

/** Minimal asset class shape for blending calculations. */
type BlendableAssetClass = {
  id: number;
  meanReturn: number;
  stdDev: number;
};

/**
 * Compute a blended deterministic return rate for a single age point.
 * Uses geometric mean (realistic compounding rate accounting for volatility drag).
 */
export function blendedReturnForAge(
  assetClasses: BlendableAssetClass[],
  allocations: Record<number, number>,
): number {
  return assetClasses.reduce((sum, ac) => {
    const w = allocations[ac.id] ?? 0;
    return w > 0 ? sum + w * geometricMean(ac.meanReturn, ac.stdDev) : sum;
  }, 0);
}

/**
 * Compute blended portfolio return and volatility for current allocation (display only).
 */
export function blendedPortfolioStats(
  assetClasses: BlendableAssetClass[],
  allocations: Record<number, number>,
): { blendedReturn: number; blendedVol: number } {
  const blendedReturn = blendedReturnForAge(assetClasses, allocations);
  const blendedVol = assetClasses.reduce(
    (sum, ac) => sum + ac.stdDev * (allocations[ac.id] ?? 0),
    0,
  );
  return { blendedReturn, blendedVol };
}
