/**
 * Coast FIRE Calculator
 *
 * Pure calculator — no DB, no tRPC, no React.
 *
 * Finds the earliest age at which the user can stop contributing to retirement
 * accounts and still fund their plan through end-of-plan. Wraps the projection
 * engine with an accumulationOverride that zeros contributionRate at a
 * candidate "coast age" and binary-searches for the earliest passing age.
 *
 * Success criterion: `portfolioDepletionAge === null` AND
 * `sustainableWithdrawal >= projectedExpenses` at the first decumulation year.
 * The first check ensures the portfolio survives through end-of-plan; the
 * second ensures the initial retirement withdrawal covers initial retirement
 * expenses. Together they answer "funds annual expenses through end of plan".
 */
import { calculateProjection } from "./engine";
import type { ProjectionInput, ProjectionResult } from "./types";

export type CoastFireStatus = "already_coast" | "found" | "unreachable";

export type CoastFireResult = {
  /** The earliest age at which contributions can stop. Null if unreachable. */
  coastFireAge: number | null;
  status: CoastFireStatus;
  /** Portfolio balance at end of plan under the coast scenario. */
  endBalance: number;
  /** Sustainable annual withdrawal at retirement under the coast scenario. */
  sustainableWithdrawal: number;
  /** Projected expenses at the first decumulation year (nominal, inflated). */
  projectedExpensesAtRetirement: number;
};

const UNREACHABLE: CoastFireResult = {
  coastFireAge: null,
  status: "unreachable",
  endBalance: 0,
  sustainableWithdrawal: 0,
  projectedExpensesAtRetirement: 0,
};

function resultFrom(
  coastFireAge: number,
  status: CoastFireStatus,
  projection: ProjectionResult,
): CoastFireResult {
  const retirementYear = projection.projectionByYear.find(
    (y) => y.phase === "decumulation",
  );
  const finalYear =
    projection.projectionByYear[projection.projectionByYear.length - 1];
  return {
    coastFireAge,
    status,
    endBalance: finalYear?.endBalance ?? 0,
    sustainableWithdrawal: projection.sustainableWithdrawal,
    projectedExpensesAtRetirement: retirementYear?.projectedExpenses ?? 0,
  };
}

/** Returns true iff the projection funds expenses through end of plan. */
function passes(projection: ProjectionResult): boolean {
  if (projection.portfolioDepletionAge !== null) return false;
  const retirementYear = projection.projectionByYear.find(
    (y) => y.phase === "decumulation",
  );
  if (!retirementYear) return false;
  return projection.sustainableWithdrawal >= retirementYear.projectedExpenses;
}

/**
 * Finds the earliest age at which contributions can stop and the plan still
 * funds expenses through end of plan.
 *
 * Algorithm: binary search over [currentAge, retirementAge). For each
 * candidate age, clones the input with an additional accumulationOverride
 * zeroing contributionRate at that year, then calls calculateProjection().
 * Cost: ~log₂(retirementAge - currentAge) engine calls.
 */
export function findCoastFireAge(input: ProjectionInput): CoastFireResult {
  const { currentAge, retirementAge, asOfDate } = input;

  // Edge case: user is already at or past retirement age. Coast FIRE is
  // undefined in this case — just return the current projection's outcome.
  if (currentAge >= retirementAge) {
    return resultFrom(currentAge, "already_coast", calculateProjection(input));
  }

  const currentYear = asOfDate.getFullYear();

  // Helper: run the projection with contributions zeroed from coastAge onward.
  const probeAt = (coastAge: number): ProjectionResult => {
    const yearOffset = coastAge - currentAge;
    return calculateProjection({
      ...input,
      accumulationOverrides: [
        ...input.accumulationOverrides,
        { year: currentYear + yearOffset, contributionRate: 0 },
      ],
    });
  };

  // If stopping today passes, user is already Coast FIRE.
  const stopNow = probeAt(currentAge);
  if (passes(stopNow)) {
    return resultFrom(currentAge, "already_coast", stopNow);
  }

  // If stopping the year before retirement doesn't pass, unreachable.
  const maxCoastAge = retirementAge - 1;
  const stopLate = probeAt(maxCoastAge);
  if (!passes(stopLate)) {
    return UNREACHABLE;
  }

  // Binary search for earliest passing age in [currentAge + 1, maxCoastAge].
  let lo = currentAge + 1;
  let hi = maxCoastAge;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (passes(probeAt(mid))) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return resultFrom(lo, "found", probeAt(lo));
}
