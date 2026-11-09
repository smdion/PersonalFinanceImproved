/**
 * Milestones: the one place financial rules and milestones are judged (`evaluateMilestones()`),
 * for every surface. Pure: callers pass the household's figures; thresholds and wording are in
 * `lib/config/milestones.ts`. Reached dates from yearly history, expected from the projection.
 */
import {
  FIDELITY_CHECKPOINTS,
  MONEY_GUY_CHECKPOINTS,
} from "@/lib/config/milestones";
import { checkpointBalance } from "@/lib/pure/advice/milestones/milestones.shared";
import type {
  MilestoneInput,
  MilestoneResult,
  MilestoneYear,
} from "@/lib/pure/advice/milestones/milestones.types";
import {
  wealthFormula,
  checkpoints,
} from "@/lib/pure/advice/milestones/wealth";
import {
  savingsRate,
  studentLoans,
  alwaysBuying,
  saveRaises,
  emergencyFund,
  pfRetirementRate,
  carRule,
} from "@/lib/pure/advice/milestones/habits";
import {
  investing,
  megaBackdoor,
  goalHorizon,
  fundCosts,
} from "@/lib/pure/advice/milestones/investing";
import { customGoal } from "@/lib/pure/advice/milestones/custom-goals";
import { journey } from "@/lib/pure/advice/milestones/journey";
import { foo } from "@/lib/pure/advice/milestones/foo";
import { protection, housing } from "@/lib/pure/advice/milestones/housing";

export * from "@/lib/pure/advice/milestones/milestones.types";

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Judge every milestone. Empty when there's no history yet. */
export function evaluateMilestones(input: MilestoneInput): MilestoneResult[] {
  const now = input.years[input.years.length - 1];
  if (!now) return [];
  const savings = savingsRate(input);
  const efund = emergencyFund("emergencyFund", input);
  return [
    ...journey(input, now),
    ...input.customGoals.map((g) => customGoal(g, input, now)),
    ...foo(input, now, savings, efund),
    wealthFormula(input, now),
    input.checkpointSource === "moneyGuy"
      ? checkpoints(
          "moneyGuyCheckpoints",
          MONEY_GUY_CHECKPOINTS,
          input,
          now,
          (y) => checkpointBalance("moneyGuy", y),
        )
      : checkpoints(
          "fidelityCheckpoints",
          FIDELITY_CHECKPOINTS,
          input,
          now,
          (y) => checkpointBalance("fidelity", y),
        ),
    input.savingsTargetSource === "personalFinance"
      ? pfRetirementRate(input)
      : savings,
    saveRaises(input),
    alwaysBuying(input),
    megaBackdoor(input),
    goalHorizon(input),
    efund,
    protection(input, now),
    ...housing(input, now),
    carRule(input, now),
    studentLoans(input),
    ...investing(input),
    fundCosts(input),
  ];
}

/** The FOO step you're on: the first one not reached and not waiting on
 *  information. Null once every judged step is done. */
export function currentFooStep(
  results: readonly MilestoneResult[],
): number | null {
  for (let step = 1; step <= 9; step++) {
    const r = results.find((x) => x.id === `foo${step}`);
    if (r && r.status === "behind") return step;
  }
  return null;
}

/** Reached milestones in date order. */
export function milestoneTimeline(
  results: readonly MilestoneResult[],
): { year: number; label: string; id: string }[] {
  return results
    .flatMap((r) => r.achievements.map((a) => ({ ...a, id: r.id })))
    .sort((a, b) => a.year - b.year || a.label.localeCompare(b.label));
}

/** The unreached milestones you're closest to (journey, your goals, wealth). */
export function nextUpMilestones(
  results: readonly MilestoneResult[],
  count = 2,
): MilestoneResult[] {
  return results
    .filter(
      (r) =>
        (r.group === "journey" ||
          r.group === "custom" ||
          r.group === "wealth") &&
        r.status !== "reached" &&
        r.progress !== null &&
        r.progress < 1,
    )
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))
    .slice(0, count);
}

/** Last finalized year next to now, for the "since last year" line. */
export function sinceLastYear(years: readonly MilestoneYear[]): {
  fromYear: number;
  netWorth: [number, number];
  liquidMultiple: [number, number] | null;
  wealthScore: [number, number];
} | null {
  const now = years[years.length - 1];
  const before = [...years].reverse().find((y) => !y.isCurrent && y !== now);
  if (!now || !before) return null;
  const mult = (y: MilestoneYear) =>
    y.grossIncome > 0 ? y.liquid / y.grossIncome : null;
  const a = mult(before);
  const b = mult(now);
  return {
    fromYear: before.year,
    netWorth: [before.netWorth, now.netWorth],
    liquidMultiple: a !== null && b !== null ? [a, b] : null,
    wealthScore: [before.wealthScore, now.wealthScore],
  };
}
