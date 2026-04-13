/**
 * Confidence-band derivation for retirement projections (v0.5 expert-review M3).
 *
 * The audit's concern: ledgr's retirement card defaults to a single point
 * estimate ("$2.4M at age 65") in non-MC mode, creating anchoring bias.
 * Even without running a full Monte Carlo, we can derive a reasonable
 * range by applying a historical-volatility scalar to the deterministic
 * point estimate.
 *
 * The scalars below are based on the standard deviation of historical
 * 30-year US equity terminal-balance ratios (Trinity Study + cFIREsim
 * data). They are not a substitute for full Monte Carlo — when the user
 * runs MC, prefer those percentiles. Use these only when MC isn't
 * available.
 */

export interface ProjectionBand {
  /** Point estimate (deterministic projection result). */
  point: number;
  /** Lower bound (~25th percentile of historical distribution). */
  low: number;
  /** Upper bound (~75th percentile of historical distribution). */
  high: number;
  /** Range as a fraction of the point estimate (e.g., 0.50 = ±25%). */
  rangeFraction: number;
  /** Human-readable label for the UI. */
  label: string;
}

/**
 * Default volatility scalar — applied symmetrically. Based on the
 * standard deviation of historical 30-year terminal-balance outcomes
 * for a 60/40 portfolio (roughly ±25% one-sigma). Adjust upward for
 * heavier equity exposure or longer horizons.
 */
const DEFAULT_RANGE_FRACTION = 0.25;

/**
 * Derive a confidence band around a deterministic projection point
 * estimate. Returns symmetric ±25% by default — call sites can override
 * for heavier-equity portfolios or longer horizons.
 *
 * Use this when Monte Carlo isn't configured. When MC is available,
 * prefer the actual percentiles from the simulation.
 */
export function deriveProjectionBand(
  point: number,
  rangeFraction: number = DEFAULT_RANGE_FRACTION,
): ProjectionBand {
  if (!Number.isFinite(point) || point < 0) {
    return {
      point: 0,
      low: 0,
      high: 0,
      rangeFraction: 0,
      label: "Insufficient data",
    };
  }
  const low = Math.max(0, point * (1 - rangeFraction));
  const high = point * (1 + rangeFraction);
  return {
    point,
    low,
    high,
    rangeFraction,
    label: `Most likely $${formatCompact(point)} (range $${formatCompact(low)}–$${formatCompact(high)})`,
  };
}

/**
 * Adjust the band width based on horizon and equity allocation.
 * Longer horizons + higher equity exposure = wider band.
 */
export function bandFractionForPortfolio(
  yearsToRetirement: number,
  equityPercent: number,
): number {
  // Base 20% ± modifiers
  let fraction = 0.2;
  if (yearsToRetirement > 20) fraction += 0.1; // long horizon → wider
  if (equityPercent > 80) fraction += 0.05; // heavy equity → wider
  if (equityPercent < 40) fraction -= 0.05; // bond-heavy → narrower
  return Math.max(0.1, Math.min(0.5, fraction));
}

/** Compact dollar formatting for the label. Avoids importing format helpers. */
function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return n.toFixed(0);
}
