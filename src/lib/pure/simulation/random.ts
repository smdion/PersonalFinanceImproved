/**
 * Seeded PRNG and statistical distribution samplers for Monte Carlo simulation.
 *
 * Pure functions — no DB, no tRPC, no React.
 * Uses a simple but effective mulberry32 PRNG seeded for reproducibility.
 */
import { safeDivide } from "../../utils/math";

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — fast, deterministic, 32-bit state
// ---------------------------------------------------------------------------

type PRNG = () => number;

/**
 * Create a seeded pseudo-random number generator (mulberry32).
 * Returns a function that produces uniform random numbers in [0, 1).
 */
export function createPRNG(seed: number): PRNG {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Normal distribution — Box-Muller transform
// ---------------------------------------------------------------------------

/**
 * Sample from a standard normal distribution (mean=0, stdDev=1).
 * Uses the Box-Muller transform for exact normal samples.
 */
function sampleNormal(rng: PRNG): number {
  const u1 = rng();
  const u2 = rng();
  // Box-Muller: avoid log(0) by clamping u1 away from 0
  return (
    Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2)
  );
}

/**
 * Sample from a normal distribution with given mean and standard deviation.
 */
export function sampleNormalMeanStd(
  rng: PRNG,
  mean: number,
  stdDev: number,
): number {
  return mean + stdDev * sampleNormal(rng);
}

// ---------------------------------------------------------------------------
// Log-normal return sampling
// ---------------------------------------------------------------------------

/**
 * Arithmetic mean/stdDev to log-normal parameters, ln(1 + R) ~ Normal(m, s²) with
 * s² = ln(1 + σ²/(1+μ)²) and m = ln(1 + μ) - s²/2, so E[1+R] = 1+μ.
 */
function logNormalParams(
  meanReturn: number,
  stdDev: number,
): { s: number; m: number } {
  const s = Math.log(
    1 + (stdDev * stdDev) / ((1 + meanReturn) * (1 + meanReturn)),
  );
  const m = Math.log(1 + meanReturn) - s / 2;
  return { s, m };
}

/**
 * Geometric mean (median compounding rate) of a log-normal return: (1+μ)·exp(-s²/2) - 1, the
 * deterministic rate matching the simulation's median; below μ by the volatility drag.
 */
export function geometricMean(meanReturn: number, stdDev: number): number {
  const { m } = logNormalParams(meanReturn, stdDev);
  return Math.exp(m) - 1;
}

/** The figures a class needs for the two weighted blends below. */
type WeightedAssetClass = { id: number; meanReturn: number; stdDev: number };

/** Σ w·G over classes above 0%: the fixed-return line and shown mix return.
 *  Not the portfolio's median rate (RULES § Known Gaps). */
export function weightedGeometricRate(
  assetClasses: readonly WeightedAssetClass[],
  allocations: Record<number, number>,
): number {
  return assetClasses.reduce((sum, ac) => {
    const w = allocations[ac.id] ?? 0;
    return w > 0 ? sum + w * geometricMean(ac.meanReturn, ac.stdDev) : sum;
  }, 0);
}

/** The mix's shown volatility, Σ w·σ, correlation left out; what
 *  a trial draws is blendedReturnStats. */
export function classWeightedVolatility(
  assetClasses: readonly WeightedAssetClass[],
  allocations: Record<number, number>,
): number {
  return assetClasses.reduce(
    (sum, ac) => sum + ac.stdDev * (allocations[ac.id] ?? 0),
    0,
  );
}

// ---------------------------------------------------------------------------
// Cholesky decomposition — for correlated multi-asset sampling
// ---------------------------------------------------------------------------

/**
 * Cholesky decomposition of a symmetric positive-definite (correlation) matrix: lower triangular
 * L with A = L × L^T, used to correlate independent normal samples.
 */
export function choleskyDecomposition(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i]![k]! * L[j]![k]!;
      }
      if (i === j) {
        const diag = matrix[i]![i]! - sum;
        // Clamp to avoid NaN from floating-point rounding
        L[i]![j] = Math.sqrt(Math.max(diag, 0));
      } else {
        L[i]![j] = safeDivide(matrix[i]![j]! - sum, L[j]![j]!, 0);
      }
    }
  }

  return L;
}

// ---------------------------------------------------------------------------
// Correlated multi-asset return sampling
// ---------------------------------------------------------------------------

type AssetClassParams = {
  id: number;
  name: string;
  meanReturn: number; // Arithmetic mean (e.g. 0.10 for 10%)
  stdDev: number; // Annual volatility (e.g. 0.15)
};

export type GlidePathEntry = {
  age: number;
  allocations: Record<number, number>; // keyed by asset class id
};

/**
 * Correlated returns for the asset classes (via the precomputed Cholesky `choleskyL`), one per
 * class in `assetClasses` order.
 */
export function sampleCorrelatedReturns(
  rng: PRNG,
  assetClasses: AssetClassParams[],
  choleskyL: number[][],
): number[] {
  const n = assetClasses.length;

  // Generate independent standard normal samples
  const z: number[] = [];
  for (let i = 0; i < n; i++) {
    z.push(sampleNormal(rng));
  }

  // Apply Cholesky to get correlated normals
  const correlated: number[] = [];
  for (let i = 0; i < n; i++) {
    let val = 0;
    for (let j = 0; j <= i; j++) {
      val += choleskyL[i]![j]! * z[j]!;
    }
    correlated.push(val);
  }

  // Convert to log-normal returns (arithmetic mean matching)
  const returns: number[] = [];
  for (let i = 0; i < n; i++) {
    const ac = assetClasses[i]!;
    const { s, m } = logNormalParams(ac.meanReturn, ac.stdDev);
    const logReturn = m + Math.sqrt(s) * correlated[i]!;
    returns.push(Math.exp(logReturn) - 1);
  }

  return returns;
}

/**
 * Blended portfolio return at `age`: per-class `assetReturns` weighted by the glide path's
 * allocations, interpolated between its ages (entries sorted by age).
 */
export function blendReturns(
  assetReturns: number[],
  assetClasses: AssetClassParams[],
  glidePath: GlidePathEntry[],
  age: number,
): number {
  if (glidePath.length === 0 || assetClasses.length === 0) return 0;

  // Find the two bracketing glide path entries for interpolation
  const allocations = interpolateAllocations(glidePath, age);

  // Blend returns using allocations
  let blended = 0;
  for (let i = 0; i < assetClasses.length; i++) {
    const weight = allocations[assetClasses[i]!.id] ?? 0;
    blended += weight * assetReturns[i]!;
  }

  return blended;
}

/** One year's portfolio return at an age: correlated asset-class draws
 *  blended by that age's glide path. Both the Simulation's yearly draw and
 *  the expected-range check sample through this. */
export function sampleBlendedReturn(
  rng: PRNG,
  assetClasses: AssetClassParams[],
  choleskyL: number[][],
  glidePath: GlidePathEntry[],
  age: number,
): number {
  return blendReturns(
    sampleCorrelatedReturns(rng, assetClasses, choleskyL),
    assetClasses,
    glidePath,
    age,
  );
}

/**
 * The exact mean and standard deviation of one year's blended return at an age (the covariance of
 * sampleCorrelatedReturns's draws weighted by the glide path). Null with nothing to blend.
 */
export function blendedReturnStats(
  assetClasses: AssetClassParams[],
  correlationMatrix: number[][],
  glidePath: GlidePathEntry[],
  age: number,
): { expectedReturn: number; volatility: number } | null {
  if (glidePath.length === 0 || assetClasses.length === 0) return null;
  const allocations = interpolateAllocations(glidePath, age);
  const weight = assetClasses.map((a) => allocations[a.id] ?? 0);
  const log = assetClasses.map((a) => logNormalParams(a.meanReturn, a.stdDev));
  let expectedReturn = 0;
  let variance = 0;
  for (let i = 0; i < assetClasses.length; i++) {
    expectedReturn += weight[i]! * assetClasses[i]!.meanReturn;
    for (let j = 0; j < assetClasses.length; j++) {
      const covariance =
        (1 + assetClasses[i]!.meanReturn) *
        (1 + assetClasses[j]!.meanReturn) *
        (Math.exp(
          correlationMatrix[i]![j]! * Math.sqrt(log[i]!.s * log[j]!.s),
        ) -
          1);
      variance += weight[i]! * weight[j]! * covariance;
    }
  }
  return { expectedReturn, volatility: Math.sqrt(Math.max(0, variance)) };
}

/**
 * Interpolate glide path allocations for a given age.
 * Uses linear interpolation between the two nearest defined ages.
 */
export function interpolateAllocations(
  glidePath: GlidePathEntry[],
  age: number,
): Record<number, number> {
  if (glidePath.length === 0) return {};
  if (glidePath.length === 1) return { ...glidePath[0]!.allocations };

  // Clamp to range
  if (age <= glidePath[0]!.age) return { ...glidePath[0]!.allocations };
  if (age >= glidePath[glidePath.length - 1]!.age) {
    return { ...glidePath[glidePath.length - 1]!.allocations };
  }

  // Find bracketing entries
  let lower = glidePath[0]!;
  let upper = glidePath[1]!;
  for (let i = 1; i < glidePath.length; i++) {
    if (glidePath[i]!.age >= age) {
      upper = glidePath[i]!;
      lower = glidePath[i - 1]!;
      break;
    }
  }

  // Linear interpolation factor
  const range = upper.age - lower.age;
  const t = safeDivide(age - lower.age, range, 0);

  // Collect all asset class IDs
  const allIds = Array.from(
    new Set([
      ...Object.keys(lower.allocations),
      ...Object.keys(upper.allocations),
    ]),
  ).map(Number);

  const result: Record<number, number> = {};
  for (const id of allIds) {
    const lowerVal = lower.allocations[id] ?? 0;
    const upperVal = upper.allocations[id] ?? 0;
    result[id] = lowerVal + t * (upperVal - lowerVal);
  }

  return result;
}

/**
 * Build a correlation matrix from asset class correlations data.
 * Returns identity matrix for missing correlations (uncorrelated).
 */
export function buildCorrelationMatrix(
  assetClasses: AssetClassParams[],
  correlations: { classAId: number; classBId: number; correlation: number }[],
): number[][] {
  const n = assetClasses.length;
  const matrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  const idToIndex = new Map(assetClasses.map((ac, i) => [ac.id, i]));

  for (const c of correlations) {
    const i = idToIndex.get(c.classAId);
    const j = idToIndex.get(c.classBId);
    if (i !== undefined && j !== undefined) {
      matrix[i]![j] = c.correlation;
      matrix[j]![i] = c.correlation; // symmetric
    }
  }

  return matrix;
}
