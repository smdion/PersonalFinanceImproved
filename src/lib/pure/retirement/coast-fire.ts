/**
 * Coast FIRE: the earliest age contributions can stop and the plan still works — `assessPlan`
 * passes and the strategy's first-retirement-year spending covers the stated need (for
 * budget-continuation strategies that second test is X >= X, so the plan judge decides).
 */
import { planRetirementAge } from "@/lib/pure/household/household-timeline";
import { strategySpending } from "./strategy-spending";
import { assessPlan } from "./plan-outcome";
import { calculateProjection } from "../engine";
import type { AccountCategory } from "../../config/account-types";
import type {
  EngineDecumulationYear,
  ProfileSwitch,
  ProjectionInput,
  ProjectionResult,
} from "../engine/types";
import { roundToCents } from "../../utils/math";
import { getAllCategories } from "../../config/account-types";

type CoastFireStatus = "already_coast" | "found" | "unreachable";

type CoastFireResult = {
  /** The earliest age at which contributions can stop. Null if unreachable. */
  coastFireAge: number | null;
  status: CoastFireStatus;
  /** Retirement money at the end of the plan under the coast scenario. */
  endRetirementBalance: number;
  /** Sustainable annual withdrawal at retirement under the coast scenario. */
  sustainableWithdrawal: number;
  /** Projected expenses at the first decumulation year (nominal, inflated). */
  projectedExpensesAtRetirement: number;
  /** At or past retirement age: nothing is left to stop, so "unreachable"
   *  means the plan itself fails. */
  retired: boolean;
};

/** Dollars of rounding slack in the no-stated-need fallback check (see passes()). */
const NET_WITHDRAWAL_ROUNDING_TOLERANCE = 1;

const UNREACHABLE: CoastFireResult = {
  coastFireAge: null,
  status: "unreachable",
  endRetirementBalance: 0,
  sustainableWithdrawal: 0,
  projectedExpensesAtRetirement: 0,
  retired: false,
};

function resultFrom(
  coastFireAge: number,
  status: CoastFireStatus,
  projection: ProjectionResult,
  retired: boolean,
): CoastFireResult {
  const retirementYear = firstRetirementYear(projection);
  const finalYear =
    projection.projectionByYear[projection.projectionByYear.length - 1];
  return {
    coastFireAge,
    status,
    endRetirementBalance: finalYear?.retirementBalance ?? 0,
    sustainableWithdrawal: projection.sustainableWithdrawal,
    // What the household spends — with Social Security on top of a
    // portfolio-sized withdrawal that's not the strategy's amount.
    projectedExpensesAtRetirement: retirementYear
      ? strategySpending(retirementYear)
      : 0,
    retired,
  };
}

/** Returns true iff the projection funds expenses through end of plan
 *  (assessPlan) AND the strategy's first-year spending meets the
 *  household's stated need — Coast FIRE's own check on top of survival. */
function passes(projection: ProjectionResult): boolean {
  // Survival: the one plan judge (retirement money lasts, every year's
  // spending funded — penalty-locked and Portfolio-only money included).
  if (!assessPlan(projection).succeeded) return false;
  const retirementYear = firstRetirementYear(projection);
  if (!retirementYear) return false;
  // Against the stated need, never `sustainableWithdrawal`. With no retirement budget set
  // there's no stated need, so the withdrawal is compared instead (no spurious failure).
  if (projection.firstDecumulationYearStatedNeed == null) {
    // `sustainableWithdrawal` is gross of tax and net of Social Security; undo both so it's in
    // the same total-spending terms as `strategySpending`.
    const netSustainableWithdrawal = roundToCents(
      projection.sustainableWithdrawal -
        retirementYear.taxCost +
        retirementYear.ssIncome,
    );
    // The two sides can be one figure rebuilt from separately-rounded parts, a cent apart,
    // so compare with a $1 tolerance.
    return (
      netSustainableWithdrawal >=
      strategySpending(retirementYear) - NET_WITHDRAWAL_ROUNDING_TOLERANCE
    );
  }
  return (
    strategySpending(retirementYear) >=
    projection.firstDecumulationYearStatedNeed -
      NET_WITHDRAWAL_ROUNDING_TOLERANCE
  );
}

function firstRetirementYear(
  projection: ProjectionResult,
): EngineDecumulationYear | undefined {
  return projection.projectionByYear.find(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );
}

/**
 * Earliest age contributions can stop and the plan still funds expenses through end of plan:
 * binary search over [currentAge, retirementAge), one engine run per probe.
 */
export function findCoastFireAge(input: ProjectionInput): CoastFireResult {
  const { currentAge } = input;
  const retirementAge = planRetirementAge(input);

  // Already retired: nothing left to stop, so "already" only when the plan
  // itself passes; otherwise it isn't reachable.
  if (currentAge >= retirementAge) {
    const projection = calculateProjection(input);
    return passes(projection)
      ? resultFrom(currentAge, "already_coast", projection, true)
      : {
          ...resultFrom(currentAge, "unreachable", projection, true),
          coastFireAge: null,
        };
  }

  // Helper: run the projection with contributions and employer match
  // zeroed from coastAge onward — the same mechanism as every router probe.
  const probeAt = (coastAge: number): ProjectionResult =>
    calculateProjection({
      ...input,
      profileSwitches: buildCoastFireProfileSwitches(input, coastAge),
    });

  // If stopping today passes, user is already Coast FIRE.
  const stopNow = probeAt(currentAge);
  if (passes(stopNow)) {
    return resultFrom(currentAge, "already_coast", stopNow, false);
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

  return resultFrom(lo, "found", probeAt(lo), false);
}

/**
 * `profileSwitches` plus a synthetic switch at the coast year zeroing contributions, employer
 * match and contribution rate (sticky forward; later user switches dropped). Every Coast FIRE
 * probe uses this: `contributionRate: 0` alone keeps Portfolio savings and flat employer money.
 */
export function buildCoastFireProfileSwitches(
  baseEngineInput: Pick<
    ProjectionInput,
    "asOfDate" | "currentAge" | "profileSwitches"
  >,
  coastAge: number,
): ProfileSwitch[] {
  const coastYear =
    baseEngineInput.asOfDate.getFullYear() +
    (coastAge - baseEngineInput.currentAge);
  const zeroRecord = Object.fromEntries(
    getAllCategories().map((c) => [c, 0]),
  ) as Record<AccountCategory, number>;
  const coastSwitch: ProfileSwitch = {
    year: coastYear,
    contributionSpecs: [],
    employerMatchRateByCategory: zeroRecord,
    baseYearContributions: zeroRecord,
    baseYearEmployerMatch: zeroRecord,
    contributionRate: 0,
  };
  const userSwitches = baseEngineInput.profileSwitches ?? [];
  return [...userSwitches.filter((s) => s.year < coastYear), coastSwitch];
}
