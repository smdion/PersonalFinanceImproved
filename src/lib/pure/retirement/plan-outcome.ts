/**
 * The one judge of "does this plan work": it fails in the first retirement year with material
 * unmet spending, or with retirement money gone while a later year still needs withdrawals
 * (Portfolio money never counts). Survival only; callers add extra tests on top.
 */
import { shortfallFloor } from "../engine/gap-year-draw";
import type { EngineDecumulationYear, ProjectionResult } from "../engine/types";

/** Why a plan failed: `depleted` (retirement money ran out), `penaltyGap` (money locked behind
 *  early-withdrawal penalties, e.g. a 401(k) before 59½), or `shortfall` (spending unmet while
 *  retirement money remained). */
export type PlanFailureReason = "depleted" | "penaltyGap" | "shortfall";

type PlanOutcome =
  | {
      succeeded: true;
      failureAge: null;
      failureYear: null;
      failureReason: null;
    }
  | {
      succeeded: false;
      failureAge: number;
      failureYear: number;
      failureReason: PlanFailureReason;
    };

const SUCCEEDED: PlanOutcome = {
  succeeded: true,
  failureAge: null,
  failureYear: null,
  failureReason: null,
};

/** Retirement money gone for the year: below the engine's materiality
 *  floor ($50 or 1% of the need) — gone in all but rounding. */
function moneyGone(y: EngineDecumulationYear): boolean {
  return y.retirementBalance < (y.shortfallMaterialityFloor ?? 1);
}

/** Why a year with unmet spending failed: `depleted` when money is gone, else `penaltyGap` when
 *  penalty-locked money is at least half of `unmetNeed` (the year's whole shortfall). */
function shortfallReason(y: EngineDecumulationYear): PlanFailureReason {
  if (moneyGone(y)) return "depleted";
  const unmet = y.unmetNeed ?? 0;
  return unmet > 0 && (y.penaltyAvoidedShortfall ?? 0) >= unmet / 2
    ? "penaltyGap"
    : "shortfall";
}

export function assessPlan(
  result: Pick<ProjectionResult, "projectionByYear">,
): PlanOutcome {
  // A paycheck gone and no reachable money to replace it, before retirement.
  for (const y of result.projectionByYear) {
    if (
      y.phase === "accumulation" &&
      y.gapDraw &&
      y.gapDraw.unmetNeed >= shortfallFloor(y.gapDraw.need)
    )
      return {
        succeeded: false,
        failureAge: y.age,
        failureYear: y.year,
        failureReason: "shortfall",
      };
  }
  const years = result.projectionByYear.filter(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );
  for (const [i, y] of years.entries()) {
    if (y.unmetNeedMaterial)
      return {
        succeeded: false,
        failureAge: y.age,
        failureYear: y.year,
        failureReason: shortfallReason(y),
      };
    // Out of money with spending still to fund in a later year: the plan
    // runs out here. With nothing left to fund (a final-year spend-down,
    // or Social Security / a pension covering everything after), it held.
    if (
      moneyGone(y) &&
      years
        .slice(i + 1)
        .some(
          (later) =>
            later.afterTaxNeed > (later.shortfallMaterialityFloor ?? 1),
        )
    )
      return {
        succeeded: false,
        failureAge: y.age,
        failureYear: y.year,
        failureReason: "depleted",
      };
  }
  return SUCCEEDED;
}

/** The most common failure reason among failing trials (ties: depleted,
 *  then penaltyGap). Null when nothing failed. */
export function dominantFailureReason(
  rates: Record<PlanFailureReason, number>,
): PlanFailureReason | null {
  const order: PlanFailureReason[] = ["depleted", "penaltyGap", "shortfall"];
  const best = order.reduce((a, b) => (rates[b] > rates[a] ? b : a));
  return rates[best] > 0 ? best : null;
}

/** How a failed plan reads in text, by reason ("runs out at 79", "falls
 *  short at 56 — money locked by early-withdrawal penalties"). Null when
 *  the plan holds. */
export function describePlanFailure(outcome: PlanOutcome): string | null {
  if (outcome.succeeded) return null;
  switch (outcome.failureReason) {
    case "depleted":
      return `runs out at age ${outcome.failureAge}`;
    case "penaltyGap":
      return `falls short at age ${outcome.failureAge} — money locked by early-withdrawal penalties`;
    case "shortfall":
      return `can't fully fund spending at age ${outcome.failureAge}`;
  }
}
