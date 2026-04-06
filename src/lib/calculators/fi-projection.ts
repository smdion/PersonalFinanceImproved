/**
 * Financial Independence projection calculator.
 *
 * Projects the year when FI will be reached based on linear extrapolation
 * of FI progress between two data points.
 *
 * Formula (from spreadsheet):
 *   annualProgress = (currentFI - priorFI) / yearsApart
 *   yearsToFI = (1 - currentFI) / annualProgress
 *   projectedYear = currentYear + round(yearsToFI)
 */

export type FIProjectionResult =
  | { status: "achieved" }
  | { status: "stalled" }
  | { status: "projected"; year: number; yearsRemaining: number };

/**
 * Project the year when FI will be reached based on progress between two years.
 *
 * @param currentFIProgress - FI progress ratio for the more recent year (e.g. 0.33)
 * @param priorFIProgress - FI progress ratio for the comparison year (e.g. 0.32)
 * @param currentYear - The more recent year (e.g. 2026)
 * @param priorYear - The comparison year (e.g. 2025)
 */
export function projectFIYear(
  currentFIProgress: number,
  priorFIProgress: number,
  currentYear: number,
  priorYear: number,
): FIProjectionResult {
  if (currentFIProgress >= 1) return { status: "achieved" };

  const yearsApart = currentYear - priorYear;
  if (yearsApart <= 0) return { status: "stalled" };

  const annualProgress = (currentFIProgress - priorFIProgress) / yearsApart;
  if (annualProgress <= 0) return { status: "stalled" };

  const yearsRemaining = (1 - currentFIProgress) / annualProgress;
  return {
    status: "projected",
    year: currentYear + Math.round(yearsRemaining),
    yearsRemaining: Math.round(yearsRemaining * 10) / 10,
  };
}

/** Format an FI projection result for display. */
export function formatFIProjection(result: FIProjectionResult): string {
  switch (result.status) {
    case "achieved":
      return "FI Achieved!";
    case "stalled":
      return "Progress Stalled";
    case "projected":
      return `${result.year} (${result.yearsRemaining.toFixed(1)} years)`;
  }
}
