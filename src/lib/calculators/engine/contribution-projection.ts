/**
 * Contribution Projection — shared per-spec projection formula.
 *
 * Used by both individual-account-tracking.ts (per-account bookkeeping,
 * prorated by year fraction) and contribution-routing.ts (yr1+ category
 * routing, full-year). Consolidated per audit Batch 2 Finding 5 — the
 * formula was duplicated 3x with already-drifting variable names
 * (`baseSalary` vs `currentSalary` for the same salary-base role).
 */
import type { ContributionSpec } from "../types";
import { safeDivide } from "../../utils/math";
import { getAccountTypeConfig } from "../../config/account-types";

export interface ProjectSpecAmountParams {
  projectedSalary: number;
  /** Salary the growth factor is measured against — `currentSalary` in
   *  individual-account-tracking.ts, `baseSalary` in contribution-routing.ts. */
  salaryBase: number;
  limitGrowthFactor: number;
  /** Year-fraction proration. Defaults to 1 (full year) — contribution-routing.ts's
   *  routeFromSpecs doesn't prorate; individual-account-tracking.ts always passes
   *  its own proRate explicitly. */
  proRate?: number;
}

/**
 * Projects a single contribution spec's raw dollar amount for the year.
 * Returns the unrounded value — callers apply `roundToCents` themselves
 * where the original call sites did, and skip it where they didn't (e.g.
 * contribution-routing.ts's Roth-fraction ratio calculation, which needs
 * the raw float).
 */
export function projectSpecAmount(
  spec: Pick<
    ContributionSpec,
    | "method"
    | "salaryFraction"
    | "value"
    | "contributionScaling"
    | "baseAnnual"
    | "category"
  >,
  params: ProjectSpecAmountParams,
): number {
  const proRate = params.proRate ?? 1;
  if (spec.method === "percent_of_salary") {
    return params.projectedSalary * spec.salaryFraction * spec.value * proRate;
  }
  if (spec.contributionScaling === "fixed_amount") {
    // Fixed-amount specs use limit growth only — independent of salary changes
    return spec.baseAnnual * params.limitGrowthFactor * proRate;
  }
  if (getAccountTypeConfig(spec.category).fixedContribScalesWithSalary) {
    const salaryGrowthFactor = safeDivide(
      params.projectedSalary,
      params.salaryBase,
      1,
    );
    return spec.baseAnnual * salaryGrowthFactor * proRate;
  }
  return spec.baseAnnual * params.limitGrowthFactor * proRate;
}
