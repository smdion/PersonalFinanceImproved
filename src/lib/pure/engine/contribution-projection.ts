/**
 * The per-spec contribution formula, shared by individual-accounts/contributions.ts (prorated)
 * and contribution-routing.ts (full-year).
 */
import type { ContributionSpec } from "./types/contribution-spec";
import { safeDivide } from "../../utils/math";
import { getAccountTypeConfig } from "../../config/account-types";

interface ProjectSpecAmountParams {
  projectedSalary: number;
  /** Salary the growth factor is measured against — `currentSalary` in
   *  individual-accounts/contributions.ts, `baseSalary` in contribution-routing.ts. */
  salaryBase: number;
  limitGrowthFactor: number;
  /** Each person's pay this year and in the base year, when the household
   *  tracks them: a person's fixed saving scales with their own pay. */
  personPay?: {
    projected: ReadonlyMap<number, number>;
    base: Readonly<Record<number, number>>;
  };
  /** Year-fraction proration. Defaults to 1 (full year) — contribution-routing.ts's
   *  routeFromSpecs doesn't prorate; individual-accounts/contributions.ts always passes
   *  its own proRate explicitly. */
  proRate?: number;
}

/**
 * A contribution spec's raw dollar amount for the year, unrounded: callers round where needed
 * (contribution-routing.ts's Roth-fraction ratio needs the raw float).
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
    | "personId"
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
    const ownBase =
      spec.personId != null ? params.personPay?.base[spec.personId] : undefined;
    const salaryGrowthFactor = ownBase
      ? safeDivide(
          params.personPay!.projected.get(spec.personId!) ?? 0,
          ownBase,
          1,
        )
      : safeDivide(params.projectedSalary, params.salaryBase, 1);
    return spec.baseAnnual * salaryGrowthFactor * proRate;
  }
  return spec.baseAnnual * params.limitGrowthFactor * proRate;
}
