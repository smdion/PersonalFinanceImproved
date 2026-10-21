/**
 * One judge for "does this plan work": every success/failure verdict
 * (simulation trials, Coast FIRE, strategy comparison, optimizers, stress
 * tests, reports, "runs out" text) reads it instead of its own rule.
 *
 * A plan fails in the first retirement year that either
 * - leaves spending unmet (`unmetNeedMaterial` — the engine's one
 *   materiality verdict, covering money that ran out, money locked behind
 *   early-withdrawal penalties, and money only in Portfolio accounts), or
 * - ends with retirement money gone (`retirementBalance` < $1) — except
 *   the plan's final year: spending it all down to the last year, every
 *   year funded, is a plan that worked (spend-to-zero strategies).
 * Portfolio money never keeps a plan alive: it isn't spent in retirement.
 *
 * Survival only — callers with an extra test (Coast FIRE's first-year need)
 * add it on top.
 */
import type { EngineDecumulationYear, ProjectionResult } from "./types";

/** Why a plan failed:
 *  - `depleted`: retirement money ran out;
 *  - `penaltyGap`: money was there but locked behind early-withdrawal
 *    penalties (e.g. a 401(k) before 59½) — short for a stretch, not broke;
 *  - `shortfall`: spending went unmet while retirement money remained
 *    (what's reachable couldn't cover it). */
export type PlanFailureReason = "depleted" | "penaltyGap" | "shortfall";

export type PlanOutcome =
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

/** The reason a year with unmet spending failed. Penalty-locked money is
 *  the reason when it is most of what went unmet (`unmetNeed` is the
 *  year's whole shortfall — what routing couldn't reach and any spending
 *  lost to tax it couldn't fund). */
function shortfallReason(y: EngineDecumulationYear): PlanFailureReason {
  // Retirement money below the engine's materiality floor for the year
  // ($50 or 1% of the need) is gone in all but rounding.
  if (y.retirementBalance < Math.max(50, y.afterTaxNeed * 0.01))
    return "depleted";
  const unmet = y.unmetNeed ?? 0;
  return unmet > 0 && (y.penaltyAvoidedShortfall ?? 0) >= unmet / 2
    ? "penaltyGap"
    : "shortfall";
}

export function assessPlan(
  result: Pick<ProjectionResult, "projectionByYear">,
): PlanOutcome {
  const years = result.projectionByYear;
  const lastYear = years.at(-1)?.year;
  for (const y of years) {
    if (y.phase !== "decumulation") continue;
    if (y.unmetNeedMaterial)
      return {
        succeeded: false,
        failureAge: y.age,
        failureYear: y.year,
        failureReason: shortfallReason(y),
      };
    if (y.retirementBalance < 1 && y.year !== lastYear)
      return {
        succeeded: false,
        failureAge: y.age,
        failureYear: y.year,
        failureReason: "depleted",
      };
  }
  return SUCCEEDED;
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
