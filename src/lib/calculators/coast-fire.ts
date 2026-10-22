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
 * Success criterion: the plan judge passes it (`assessPlan` — every
 * retirement year funded, retirement money lasting) AND the strategy's
 * actual first-decumulation-year spending
 * (`projectionByYear[firstDecumYear].projectedExpenses` — already the real
 * per-strategy output, not a generic rate) covers the household's stated
 * need (`firstDecumulationYearStatedNeed`, the inflated retirement budget).
 * The first check ensures retirement money funds every year; the
 * second ensures the strategy's actual withdrawal covers what the household
 * said they need. Together they answer "funds annual expenses through end
 * of plan".
 *
 * Previously this compared `sustainableWithdrawal` (a flat
 * `balance × withdrawalRate` reference figure that only 4 of 8 strategies'
 * spending math ever reads) against `projectedExpenses`. For the other 4
 * strategies (RMD-Based, Constant %, Endowment, Vanguard Dynamic),
 * `projectedExpenses` IS the strategy's own computed spending by this point
 * in the year (see pre-year-setup.ts's spending-strategy dispatch), so the
 * old check compared an unrelated rate against the strategy's real number
 * instead of against the household's need — comparing against
 * `sustainableWithdrawal` here would make the check `X >= X` (always true)
 * once that field is made strategy-real, so this deliberately compares
 * against the stated need instead, never against `sustainableWithdrawal`.
 *
 * Note this check has real discriminating power only for the 4
 * balance-derived strategies above. For the 4 budget-continuation strategies
 * (Fixed, Forgo-Inflation-After-Loss, Spending-Decline, Guyton-Klinger on an
 * ordinary first year), `projectedExpenses` passes through unchanged from
 * the same stated-need value on the first decumulation year — so
 * `projectedExpenses >= firstDecumulationYearStatedNeed` is `X >= X` by
 * construction for those 4, and this check contributes nothing beyond the
 * `assessPlan` check above. That's correct,
 * not a bug — those strategies' entire premise is "spend what you said you
 * need" — but it means their Coast FIRE result rests entirely on the plan
 * judge.
 */
import { assessPlan } from "./plan-outcome";
import { calculateProjection } from "./engine";
import type {
  AccountCategory,
  ProfileSwitch,
  ProjectionInput,
  ProjectionResult,
} from "./types";
import { roundToCents } from "../utils/math";
import { getAllCategories } from "../config/account-types";

export type CoastFireStatus = "already_coast" | "found" | "unreachable";

export type CoastFireResult = {
  /** The earliest age at which contributions can stop. Null if unreachable. */
  coastFireAge: number | null;
  status: CoastFireStatus;
  /** Retirement money at the end of the plan under the coast scenario. */
  endRetirementBalance: number;
  /** Sustainable annual withdrawal at retirement under the coast scenario. */
  sustainableWithdrawal: number;
  /** Projected expenses at the first decumulation year (nominal, inflated). */
  projectedExpensesAtRetirement: number;
};

/** Dollars of rounding slack in the no-stated-need fallback check (see passes()). */
const NET_WITHDRAWAL_ROUNDING_TOLERANCE = 1;

const UNREACHABLE: CoastFireResult = {
  coastFireAge: null,
  status: "unreachable",
  endRetirementBalance: 0,
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
    endRetirementBalance: finalYear?.retirementBalance ?? 0,
    sustainableWithdrawal: projection.sustainableWithdrawal,
    projectedExpensesAtRetirement: retirementYear?.projectedExpenses ?? 0,
  };
}

/** Returns true iff the projection funds expenses through end of plan
 *  (assessPlan) AND the strategy's first-year spending meets the
 *  household's stated need — Coast FIRE's own check on top of survival. */
function passes(projection: ProjectionResult): boolean {
  // Survival: the one plan judge (retirement money lasts, every year's
  // spending funded — penalty-locked and Portfolio-only money included).
  if (!assessPlan(projection).succeeded) return false;
  const retirementYear = projection.projectionByYear.find(
    (y) => y.phase === "decumulation",
  );
  if (!retirementYear) return false;
  // Compare the strategy's actual first-year spending against the
  // household's stated need — NOT against `sustainableWithdrawal` (see the
  // strategy-real fix note above). When no retirement budget is set
  // (`firstDecumulationYearStatedNeed` is null), there's no stated need to
  // check against — fall back to the old behavior so an unconfigured
  // household doesn't get a spurious failure.
  if (projection.firstDecumulationYearStatedNeed == null) {
    // Making `sustainableWithdrawal` strategy-real changed
    // `sustainableWithdrawal`'s meaning to the strategy's actual
    // tax-grossed-up withdrawal (`targetWithdrawal` — gross of tax, net of
    // Social Security), but this fallback still compared it directly
    // against `projectedExpenses` (gross of Social Security, net of tax) —
    // mixed units, systematically wrong by both the tax bill and whatever
    // Social Security covers. Undo both adjustments before comparing so
    // both sides are in the same "total household spending" terms
    // `projectedExpenses` is in.
    const netSustainableWithdrawal = roundToCents(
      projection.sustainableWithdrawal -
        retirementYear.taxCost +
        retirementYear.ssIncome,
    );
    // For the budget-continuation strategies the two sides are the same
    // figure rebuilt from separately-rounded parts, so they can differ by a
    // cent — and a strict `>=` then failed every probe, reporting a
    // fully-funded plan as "unreachable". Compare with a $1 tolerance.
    return (
      netSustainableWithdrawal >=
      retirementYear.projectedExpenses - NET_WITHDRAWAL_ROUNDING_TOLERANCE
    );
  }
  return (
    retirementYear.projectedExpenses >=
    projection.firstDecumulationYearStatedNeed
  );
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
  const { currentAge, retirementAge } = input;

  // Edge case: user is already at or past retirement age. Coast FIRE is
  // undefined in this case — just return the current projection's outcome.
  if (currentAge >= retirementAge) {
    return resultFrom(currentAge, "already_coast", calculateProjection(input));
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

/**
 * Build a merged `profileSwitches` array that zeros contributions + employer
 * match from the Coast FIRE age onward.
 *
 * Injects a synthetic `ProfileSwitch` at `coastYear = currentYear + (coastAge
 * - currentAge)` with empty contribution specs, zero employer match rates,
 * zero base-year contributions/match, and contribution rate 0. The engine at
 * projection-year-handlers.ts:582-611 processes switches sticky-forward, so
 * every year from coastYear onward sees zero contributions AND zero employer
 * match. An accumulation override of `contributionRate: 0` would NOT do
 * this — the engine's rate ceiling treats a zero rate as "unset" — so every
 * Coast FIRE probe (this file's baseline finder included) uses this.
 *
 * Merges with the user's own `profileSwitches`: keeps any user-authored
 * switches strictly before the coast year (so pre-coast years still reflect
 * the user's configured future), and drops user switches at or after the
 * coast year (those are moot — everything's zero from coast year forward).
 *
 * Used by findCoastFireAge (the baseline), computeProjection,
 * computeMonteCarloProjection (when rendering the coast scenario chart),
 * and computeCoastFireMC (when probing inside the binary search).
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
