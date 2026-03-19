/**
 * Seeded PRNG and statistical distribution samplers for Monte Carlo simulation.
 *
 * Pure functions — no DB, no tRPC, no React.
 * Uses a simple but effective mulberry32 PRNG seeded for reproducibility.
 */

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — fast, deterministic, 32-bit state
// ---------------------------------------------------------------------------

export type PRNG = () => number;

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
export function sampleNormal(rng: PRNG): number {
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
 * Compute the geometric mean (median compounding rate) for a log-normal return distribution.
 *
 * Given arithmetic mean μ and volatility σ, the geometric mean is:
 *   geo = (1+μ) · exp(-s²/2) - 1
 *   where s² = ln(1 + σ²/(1+μ)²)
 *
 * This is the rate at which a portfolio deterministically compounds to match
 * the median outcome of the stochastic simulation. Always lower than the
 * arithmetic mean by the "volatility drag" factor.
 */
export function geometricMean(meanReturn: number, stdDev: number): number {
  const s = Math.log(
    1 + (stdDev * stdDev) / ((1 + meanReturn) * (1 + meanReturn)),
  );
  return Math.exp(Math.log(1 + meanReturn) - s / 2) - 1;
}

/**
 * Sample an annual return from a log-normal distribution.
 *
 * If arithmetic mean return = μ and annual volatility = σ, then:
 *   ln(1 + R) ~ Normal(m, s²)
 *   where s² = ln(1 + σ²/(1+μ)²),  m = ln(1 + μ) - s²/2
 *
 * This ensures the arithmetic mean E[1+R] = 1+μ.
 * The geometric mean (median compounding rate) is lower due to volatility drag:
 *   Median[1+R] = (1+μ) · exp(-s²/2)
 *
 * @param rng - Seeded PRNG
 * @param meanReturn - Expected arithmetic mean return (e.g. 0.10 for 10%)
 * @param stdDev - Annual volatility (e.g. 0.15 for 15%)
 * @returns Annual return as decimal (e.g. 0.12 for 12% gain, -0.08 for 8% loss)
 */
export function sampleLogNormalReturn(
  rng: PRNG,
  meanReturn: number,
  stdDev: number,
): number {
  // Convert to log-space parameters
  // μ is the arithmetic mean: E[1+R] = 1+μ
  // Geometric mean (compounding rate) is lower by exp(-s²/2) due to volatility drag
  const s = Math.log(
    1 + (stdDev * stdDev) / ((1 + meanReturn) * (1 + meanReturn)),
  );
  const m = Math.log(1 + meanReturn) - s / 2;
  const logReturn = sampleNormalMeanStd(rng, m, Math.sqrt(s));
  return Math.exp(logReturn) - 1;
}

// ---------------------------------------------------------------------------
// Cholesky decomposition — for correlated multi-asset sampling
// ---------------------------------------------------------------------------

/**
 * Cholesky decomposition of a symmetric positive-definite matrix.
 * Returns lower triangular matrix L such that A = L × L^T.
 *
 * Used to generate correlated normal samples from independent ones.
 *
 * @param matrix - Correlation matrix (n×n, symmetric positive-definite)
 * @returns Lower triangular matrix L
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
        L[i]![j] = L[j]![j]! > 0 ? (matrix[i]![j]! - sum) / L[j]![j]! : 0;
      }
    }
  }

  return L;
}

// ---------------------------------------------------------------------------
// Correlated multi-asset return sampling
// ---------------------------------------------------------------------------

export type AssetClassParams = {
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
 * Sample correlated returns for multiple asset classes using Cholesky decomposition.
 *
 * @param rng - Seeded PRNG
 * @param assetClasses - Asset class parameters (mean, stdDev)
 * @param choleskyL - Pre-computed Cholesky lower triangular matrix
 * @returns Array of returns, one per asset class (same order as assetClasses)
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
    const s = Math.log(
      1 + (ac.stdDev * ac.stdDev) / ((1 + ac.meanReturn) * (1 + ac.meanReturn)),
    );
    const m = Math.log(1 + ac.meanReturn) - s / 2;
    const logReturn = m + Math.sqrt(s) * correlated[i]!;
    returns.push(Math.exp(logReturn) - 1);
  }

  return returns;
}

/**
 * Get blended portfolio return for a given age using glide path allocations.
 *
 * Interpolates allocations between defined glide path ages.
 *
 * @param assetReturns - Per-asset-class returns (same order as assetClasses)
 * @param assetClasses - Asset class definitions (for name lookup)
 * @param glidePath - Glide path entries sorted by age
 * @param age - Current age
 * @returns Blended portfolio return for this year
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
  const t = range > 0 ? (age - lower.age) / range : 0;

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

  const idToIdx = new Map(assetClasses.map((ac, i) => [ac.id, i]));

  for (const c of correlations) {
    const i = idToIdx.get(c.classAId);
    const j = idToIdx.get(c.classBId);
    if (i !== undefined && j !== undefined) {
      matrix[i]![j] = c.correlation;
      matrix[j]![i] = c.correlation; // symmetric
    }
  }

  return matrix;
}
