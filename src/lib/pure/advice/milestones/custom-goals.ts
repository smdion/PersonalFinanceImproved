/** The household's own goals, judged like the journey milestones. */
import {
  CUSTOM_GOAL_METRICS,
  type CustomGoalMetric,
  type MilestoneDefinition,
} from "@/lib/config/milestones";
import { formatCurrency } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import {
  expectedNote,
  firstProjectedYear,
  firstReachedYear,
  inflateTarget,
  reachedNote,
} from "@/lib/pure/advice/milestones/milestones.shared";
import type {
  CustomGoal,
  MilestoneInput,
  MilestoneProjectionYear,
  MilestoneResult,
  MilestoneValue,
  MilestoneYear,
} from "@/lib/pure/advice/milestones/milestones.types";

// ---------------------------------------------------------------------------
// Custom goals
// ---------------------------------------------------------------------------

function customGoalValue(metric: CustomGoalMetric, y: MilestoneYear): number {
  switch (metric) {
    case "netWorth":
      return y.netWorth;
    case "liquid":
      return y.liquid;
    case "invested":
      return y.liquid - y.cash;
    case "retirement":
      return y.retirement;
    case "brokerage":
      return y.brokerage;
  }
}

export function customGoal(
  goal: CustomGoal,
  input: MilestoneInput,
  now: MilestoneYear,
): MilestoneResult {
  const inflation = input.projection?.inflationRate ?? 0;
  const targetIn = (year: number) =>
    goal.todaysDollars
      ? inflateTarget(goal.target, goal.setYear, year, inflation)
      : goal.target;
  const current = customGoalValue(goal.metric, now);
  const targetNow = targetIn(input.asOfYear);
  const reachedYear = firstReachedYear(
    input.years,
    (y) => customGoalValue(goal.metric, y) >= targetIn(y.year),
  );
  const nonLiquid = now.netWorth - now.liquid;
  // Projected liquid holds today's cash flat, so invested is liquid less
  // today's cash.
  const projected =
    goal.metric === "liquid"
      ? (y: MilestoneProjectionYear) => y.liquid
      : goal.metric === "invested"
        ? (y: MilestoneProjectionYear) => y.liquid - now.cash
        : goal.metric === "netWorth"
          ? (y: MilestoneProjectionYear) => y.liquid + nonLiquid
          : null;
  const expected =
    reachedYear === null && projected && input.projection
      ? firstProjectedYear(
          input.projection.years,
          input.asOfYear,
          (y) => projected(y) >= targetIn(y.year),
        )
      : null;
  const def: MilestoneDefinition = {
    id: `custom:${goal.id}`,
    group: "custom",
    source: "custom",
    title: goal.label,
    rule: `${CUSTOM_GOAL_METRICS[goal.metric]} of ${formatCurrency(goal.target)}${
      goal.todaysDollars ? ` in ${goal.setYear} dollars` : ""
    }.`,
    focus: { topic: "milestone", milestoneId: `custom:${goal.id}` },
  };
  const headline = `${formatCurrency(current)} of ${formatCurrency(targetNow)}`;
  const base = {
    ...def,
    alert: false,
    value: { kind: "currency", amount: current } as MilestoneValue,
    target: { kind: "currency", amount: targetNow } as MilestoneValue,
    headline,
    short: headline,
    expectedYear: expected?.year ?? null,
    expectedAge: expected?.age ?? null,
  };
  if (reachedYear !== null) {
    return {
      ...base,
      status: "reached",
      progress: 1,
      note: reachedNote(reachedYear, input.years, current >= targetNow),
      nextStep: null,
      impact: null,
      reachedYear,
      achievements: [{ year: reachedYear, label: goal.label }],
    };
  }
  return {
    ...base,
    status:
      !projected || !input.projection
        ? "unknown"
        : expected
          ? "onTrack"
          : "behind",
    progress: Math.max(0, Math.min(1, safeDivide(current, targetNow, 0))),
    note: projected
      ? expectedNote(expected, input, goal.metric === "netWorth")
      : null,
    nextStep: `${formatCurrency(Math.max(0, targetNow - current))} to go`,
    impact: { kind: "oneTime", amount: Math.max(0, targetNow - current) },
    reachedYear: null,
    achievements: [],
  };
}
