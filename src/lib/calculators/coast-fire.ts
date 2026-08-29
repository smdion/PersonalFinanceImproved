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
 * Success criterion: `portfolioDepletionAge === null` AND the strategy's
 * actual first-decumulation-year spending
 * (`projectionByYear[firstDecumYear].projectedExpenses` — already the real
 * per-strategy output, not a generic rate) covers the household's stated
 * need (`firstDecumulationYearStatedNeed`, the inflated retirement budget).
 * The first check ensures the portfolio survives through end-of-plan; the
 * second ensures the strategy's actual withdrawal covers what the household
 * said they need. Together they answer "funds annual expenses through end
 * of plan".
 *
 * v0.7.9 R45 fix: previously compared `sustainableWithdrawal` (a flat
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
 * `portfolioDepletionAge`/penalty-shortfall checks above. That's correct,
 * not a bug — those strategies' entire premise is "spend what you said you
 * need" — but it means their Coast FIRE result rests entirely on those other
 * two checks, same as before this fix.
 */
import { calculateProjection } from "./engine";
import type { ProjectionInput, ProjectionResult } from "./types";
import { roundToCents } from "../utils/math";

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

/** Returns true iff the projection funds expenses through end of plan.
 *
 *  v0.7.8 penalty-hard-exclusion follow-up: a plan can fail to fund a
 *  specific year (money went unreached because it was penalty-exposed —
 *  see `penaltyAvoidedShortfall` on `EngineDecumulationYear`) while still
 *  passing both checks below, since neither one looks at individual years
 *  -- `portfolioDepletionAge` only fires on a genuine zero-out, and
 *  `sustainableWithdrawal` is an aggregate rate that a shortfall year the
 *  household never spent (because it legally couldn't reach the money)
 *  doesn't move. Same class of bug `monte-carlo.ts`'s C3 fix addressed for
 *  the simulated success rate; this is the deterministic-baseline half of
 *  the same fix. Without it, the baseline can say "already coast" for a
 *  plan whose 55→59½ gap Monte Carlo correctly reports as failing. */
function passes(projection: ProjectionResult): boolean {
  if (projection.portfolioDepletionAge !== null) return false;
  const retirementYear = projection.projectionByYear.find(
    (y) => y.phase === "decumulation",
  );
  if (!retirementYear) return false;
  // Materiality floor (advisor review, 2026-08-27), matching
  // decumulation-year.ts's identically-reasoned `finalUnmetNeed` floor: a
  // rounding-scale penaltyAvoidedShortfall in any single one of ~40 years
  // shouldn't flip an entire plan from "already coast" to "not coast" —
  // reserve that verdict for a shortfall material enough to actually
  // matter to the household.
  const hadPenaltyAvoidedShortfall = projection.projectionByYear.some(
    (y) =>
      y.phase === "decumulation" &&
      (y.penaltyAvoidedShortfall ?? 0) >
        Math.max(50, (y.afterTaxNeed ?? 0) * 0.01),
  );
  if (hadPenaltyAvoidedShortfall) return false;
  // Advisor review, 2026-08-29 (finding #8): `nonRetirementShortfall` is
  // structurally identical to `penaltyAvoidedShortfall` above — a real
  // household shortfall (R49: money in a Portfolio-parented account
  // routing unconditionally excludes) that neither `portfolioDepletionAge`
  // nor `sustainableWithdrawal` would ever notice, for the same reason the
  // comment above `passes()` explains for the penalty-exclusion case.
  const hadNonRetirementShortfall = projection.projectionByYear.some(
    (y) =>
      y.phase === "decumulation" &&
      (y.nonRetirementShortfall ?? 0) >
        Math.max(50, (y.afterTaxNeed ?? 0) * 0.01),
  );
  if (hadNonRetirementShortfall) return false;
  // Compare the strategy's actual first-year spending against the
  // household's stated need — NOT against `sustainableWithdrawal` (see the
  // R45 fix note above). When no retirement budget is set
  // (`firstDecumulationYearStatedNeed` is null), there's no stated need to
  // check against — fall back to the old behavior so an unconfigured
  // household doesn't get a spurious failure.
  if (projection.firstDecumulationYearStatedNeed == null) {
    // Advisor review, 2026-08-29 (finding #9): R45 Step 2 changed
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
    return netSustainableWithdrawal >= retirementYear.projectedExpenses;
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
