/**
 * Glide path warnings: whether a stock allocation suits the age by the "110 - age" rule of thumb,
 * as structured, non-blocking warnings (severity + range) the UI can surface.
 */

type GlidePathWarning = {
  severity: "info" | "warn" | "danger";
  /** The user's current stock % (0-100). */
  currentStockPercent: number;
  /** The recommended stock % per the 110-age rule (0-100). */
  recommendedStockPercent: number;
  /** Absolute deviation in percentage points. */
  deviationPoints: number;
  /** Human-readable message for the UI callout. */
  message: string;
};

const RECOMMENDED_RULE_BASE = 110;

/** Recommended stock % by the "110 - age" rule, clamped to [0, 100]; a starting point. */
export function recommendedStockPercent(age: number): number {
  if (!Number.isFinite(age) || age < 0) return 100;
  return Math.max(0, Math.min(100, RECOMMENDED_RULE_BASE - age));
}

/**
 * A stock allocation against the age-based recommendation: null within 10pp, else "info"
 * (10–20pp), "warn" (20–35pp) or "danger" (> 35pp). Wide bands: the rule is only a heuristic.
 */
export function checkGlidePath(
  age: number,
  currentStockPercent: number,
): GlidePathWarning | null {
  if (
    !Number.isFinite(age) ||
    !Number.isFinite(currentStockPercent) ||
    age < 0 ||
    currentStockPercent < 0 ||
    currentStockPercent > 100
  ) {
    return null;
  }
  const recommended = recommendedStockPercent(age);
  const dev = currentStockPercent - recommended;
  const absDev = Math.abs(dev);
  if (absDev <= 10) return null;

  let severity: GlidePathWarning["severity"];
  if (absDev <= 20) severity = "info";
  else if (absDev <= 35) severity = "warn";
  else severity = "danger";

  const direction = dev > 0 ? "more aggressive" : "more conservative";
  const message =
    `Your simulation's assumed stock allocation (${Math.round(currentStockPercent)}%) is ${Math.round(absDev)}pp ${direction} ` +
    `than the "110 − age" rule of thumb suggests for age ${age} (${recommended}%). ` +
    `This check uses your configured glide path, not actual holdings.`;

  return {
    severity,
    currentStockPercent,
    recommendedStockPercent: recommended,
    deviationPoints: Math.round(absDev),
    message,
  };
}
