/**
 * One judge for "does this plan work": every success/failure verdict
 * (simulation trials, Coast FIRE, strategy comparison, optimizers, stress
 * tests, reports, "runs out" text) reads it instead of its own rule.
 *
 * A plan fails in the first retirement year that either
 * - leaves spending unmet (`unmetNeedMaterial` — the engine's one
 *   materiality verdict, covering money that ran out, money locked behind
 *   early-withdrawal penalties, and money only in Portfolio accounts), or
 * - ends with retirement money gone (below the engine's materiality floor)
 *   while a later year still needs withdrawals — spending down to the last
 *   year, or onto Social Security / a pension that covers the rest, is a
 *   plan that worked.
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

/** Retirement money gone for the year: below the engine's materiality
 *  floor ($50 or 1% of the need) — gone in all but rounding. */
function moneyGone(y: EngineDecumulationYear): boolean {
  return y.retirementBalance < (y.shortfallMaterialityFloor ?? 1);
}

/** The reason a year with unmet spending failed. Penalty-locked money is
 *  the reason when it is most of what went unmet (`unmetNeed` is the
 *  year's whole shortfall — what routing couldn't reach and any spending
 *  lost to tax it couldn't fund). */
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

/** What failing means, by reason, as a phrase ("money runs out"). */
export function planFailurePhrase(reason: PlanFailureReason): string {
  switch (reason) {
    case "depleted":
      return "money runs out";
    case "penaltyGap":
      return "the plan falls short — money locked by early-withdrawal penalties";
    case "shortfall":
      return "the plan can't fully fund spending";
  }
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
