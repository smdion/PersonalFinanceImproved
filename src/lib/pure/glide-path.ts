/**
 * Glide path warnings — simple "is your stock allocation appropriate
 * for your age" check using the classic "110 - age" rule of thumb.
 *
 * Closes the v0.5 expert-review M6 finding: ledgr's projection engine
 * doesn't surface allocation/age mismatches. Users can run a 95% stock
 * portfolio at age 60 with no warning. This module provides a pure
 * helper that any UI can call to surface a yellow callout.
 *
 * The 110-age rule is a heuristic, not a mandate. The helper returns
 * structured warnings (severity + range) so the UI can render them
 * non-blocking and the user can override.
 */

export type GlidePathWarning = {
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

/**
 * Compute the recommended stock allocation per the "110 - age" rule.
 * Clamped to [0, 100]. The rule is a starting point — users with high
 * risk tolerance + long horizons may go higher; conservative users may
 * go lower.
 */
export function recommendedStockPercent(age: number): number {
  if (!Number.isFinite(age) || age < 0) return 100;
  return Math.max(0, Math.min(100, RECOMMENDED_RULE_BASE - age));
}

/**
 * Check a user's stock allocation against the age-based recommendation.
 * Returns null if the allocation is within tolerance, or a warning
 * object if it's off by more than the tolerance threshold.
 *
 * Tolerance bands:
 *   |dev| ≤ 10pp        → null (within tolerance)
 *   |dev| 10–20pp       → "info" (mild deviation, user may have a reason)
 *   |dev| 20–35pp       → "warn" (significant — surface a callout)
 *   |dev| > 35pp        → "danger" (very out of line, especially near retirement)
 *
 * The thresholds are deliberately wide because the 110-age rule is a
 * heuristic, not a hard line. We don't want to nag users who are
 * intentionally diverging.
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
    `Your stock allocation (${currentStockPercent}%) is ${absDev}pp ${direction} ` +
    `than the "110 − age" rule of thumb suggests for age ${age} (${recommended}%). ` +
    `This is a heuristic, not a mandate — but if you don't have a specific ` +
    `reason for the deviation, consider rebalancing toward the recommendation.`;

  return {
    severity,
    currentStockPercent,
    recommendedStockPercent: recommended,
    deviationPoints: Math.round(absDev),
    message,
  };
}
