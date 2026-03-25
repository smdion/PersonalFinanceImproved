/**
 * Pure business logic for Monte Carlo projection calculations.
 * Extracted from projection router — no DB or I/O dependency.
 */
import { geometricMean } from "@/lib/calculators/random";
import type { GlidePathEntry } from "@/lib/calculators/random";

/** Minimal asset class shape for blending calculations. */
export type BlendableAssetClass = {
  id: number;
  meanReturn: number;
  stdDev: number;
};

/**
 * Interpolate allocation weights for a given age from a glide path.
 * Finds the nearest entry at-or-above the target age, or uses the first entry.
 */
export function interpolateAllocations(
  glidePath: GlidePathEntry[],
  age: number,
): Record<number, number> {
  // This delegates to the engine's interpolation, but we replicate the simple
  // lookup here for the deterministic rate blending (which doesn't need full engine).
  const entry = glidePath.find((gp) => gp.age >= age) ?? glidePath[0];
  return entry?.allocations ?? {};
}

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
 * Build MC-aligned deterministic return rates across an age range.
 * Returns per-age blended geometric-mean returns for the deterministic comparison line.
 */
export function blendDeterministicRates(
  assetClasses: BlendableAssetClass[],
  glidePath: GlidePathEntry[],
  startAge: number,
  endAge: number,
): { label: string; rate: number }[] {
  const rates: { label: string; rate: number }[] = [];
  for (let a = startAge; a <= endAge; a++) {
    const allocations = interpolateAllocations(glidePath, a);
    rates.push({
      label: `Age ${a}`,
      rate: blendedReturnForAge(assetClasses, allocations),
    });
  }
  return rates;
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
