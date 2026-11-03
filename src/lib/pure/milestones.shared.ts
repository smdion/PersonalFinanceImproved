/**
 * The building blocks every milestone judge shares: checkpoint and
 * savings-rate tests, first reached/projected years, and the result
 * builders for "reach this amount" and "growth beats a figure" milestones.
 */
import {
  CHECKPOINT_START_AGE,
  MILESTONE_BY_ID,
  MONEY_GUY_NAPKIN_RETURN,
  MONEY_GUY_SAVINGS_RATE,
  type BuiltInMilestoneId,
  type CheckpointSource,
  type IncomeCheckpoint,
  type MilestoneDefinition,
} from "@/lib/config/milestones";
import { SAVINGS_RATE_DECIMALS } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import type {
  MilestoneInput,
  MilestoneProjectionYear,
  MilestoneResult,
  MilestoneValue,
  MilestoneYear,
} from "@/lib/pure/milestones.types";

/** The money a checkpoint table measures: Money Guy counts liquid
 *  investments (retirement + brokerage + HSA + cash), Fidelity retirement
 *  savings only. */
export function checkpointBalance(
  source: CheckpointSource,
  y: Pick<MilestoneYear, "liquid" | "retirement">,
): number {
  return source === "moneyGuy" ? y.liquid : y.retirement;
}

/** The income multiple a checkpoint table expects at an age (linear between
 *  checkpoints, from 0× at CHECKPOINT_START_AGE; flat past the last). */
export function incomeMultipleTarget(
  checkpoints: readonly IncomeCheckpoint[],
  age: number,
): number {
  let previous: IncomeCheckpoint = { age: CHECKPOINT_START_AGE, multiple: 0 };
  for (const cp of checkpoints) {
    if (age <= cp.age) {
      if (age <= previous.age) return previous.multiple;
      const t = (age - previous.age) / (cp.age - previous.age);
      return previous.multiple + t * (cp.multiple - previous.multiple);
    }
    previous = cp;
  }
  return previous.multiple;
}

/** First history year that meets a test. Finalized years only unless
 *  `includeCurrent` (point-in-time balances can count the current year;
 *  yearly flows can't, since they're still accruing). */
export function firstReachedYear(
  years: readonly MilestoneYear[],
  test: (y: MilestoneYear) => boolean,
  includeCurrent = true,
): number | null {
  for (const y of years) {
    if (!includeCurrent && y.isCurrent) continue;
    if (test(y)) return y.year;
  }
  return null;
}

/** First projected year after `asOfYear` that meets a test. */
export function firstProjectedYear(
  years: readonly MilestoneProjectionYear[],
  asOfYear: number,
  test: (y: MilestoneProjectionYear) => boolean,
): { year: number; age: number } | null {
  const hit = years.find((y) => y.year > asOfYear && test(y));
  return hit ? { year: hit.year, age: hit.age } : null;
}

/** Savings-rate targets are round numbers: a rate that rounds (to a whole
 *  percent) to the target meets it — 24.9% meets 25%. Every savings-rate
 *  threshold check goes through this, so the dashboard and Milestones agree. */
export function meetsRateTarget(rate: number, target: number): boolean {
  const scale = 10 ** (2 + SAVINGS_RATE_DECIMALS);
  return Math.round(rate * scale) >= Math.round(target * scale);
}

/** Money Guy's 25%, as a round number. */
export function meetsMoneyGuyRate(rate: number): boolean {
  return meetsRateTarget(rate, MONEY_GUY_SAVINGS_RATE);
}

/** A target set in one year's dollars, in another year's dollars. */
export function inflateTarget(
  amount: number,
  fromYear: number,
  toYear: number,
  inflationRate: number,
): number {
  return amount * Math.pow(1 + inflationRate, toYear - fromYear);
}

/**
 * The year the projection crosses the FI number. The FI number is in today's
 * dollars and the projection is nominal, so the number grows with inflation
 * each year — comparing today's-dollar expenses with a nominal balance would
 * call FI years early.
 */
export function projectedFiYear(
  years: readonly MilestoneProjectionYear[],
  fiTargetToday: number,
  inflationRate: number,
  asOfYear: number,
): { year: number; age: number } | null {
  if (fiTargetToday <= 0) return null;
  return firstProjectedYear(
    years,
    asOfYear,
    (y) =>
      y.liquid >= inflateTarget(fiTargetToday, asOfYear, y.year, inflationRate),
  );
}

export function definition(id: BuiltInMilestoneId): MilestoneDefinition {
  return MILESTONE_BY_ID[id];
}

export function result(
  id: BuiltInMilestoneId,
  fields: Partial<MilestoneResult> &
    Pick<MilestoneResult, "status" | "headline">,
): MilestoneResult {
  return {
    ...definition(id),
    alert: false,
    value: null,
    target: null,
    progress: null,
    note: null,
    nextStep: null,
    reachedYear: null,
    expectedYear: null,
    expectedAge: null,
    achievements: [],
    impact: null,
    ...fields,
    short: fields.short ?? fields.headline,
  };
}

export function reachedNote(
  reachedYear: number,
  years: readonly MilestoneYear[],
  stillMet: boolean,
): string {
  const firstOnRecord = years[0]?.year === reachedYear;
  const when = firstOnRecord
    ? `By ${reachedYear} (first year on record)`
    : `Reached ${reachedYear}`;
  return stillMet ? when : `${when} · currently below`;
}

export function expectedNote(
  expected: { year: number; age: number } | null,
  input: MilestoneInput,
  estimate = false,
): string | null {
  if (!input.projection) return null;
  if (!expected) return "Not reached in the projection";
  const prefix = estimate ? "About" : "On pace for";
  return `${prefix} ${expected.year}`;
}

/**
 * A "reach this amount" milestone: reached when any year met it (and says so
 * if it has since dipped below), otherwise on track when the projection gets
 * there, behind when it doesn't.
 */
export function amountMilestone(
  id: BuiltInMilestoneId,
  input: MilestoneInput,
  opts: {
    current: number;
    target: number;
    history: (y: MilestoneYear) => number;
    projected: ((y: MilestoneProjectionYear) => number) | null;
    estimate?: boolean;
  },
): MilestoneResult {
  const { current, target } = opts;
  const reachedYear = firstReachedYear(
    input.years,
    (y) => opts.history(y) >= target,
  );
  const value: MilestoneValue = { kind: "currency", amount: current };
  const targetValue: MilestoneValue = { kind: "currency", amount: target };
  const headline = `${formatCurrency(current)} of ${formatCurrency(target)}`;
  if (reachedYear !== null) {
    return result(id, {
      status: "reached",
      value,
      target: targetValue,
      progress: 1,
      headline,
      reachedYear,
      note: reachedNote(reachedYear, input.years, current >= target),
      achievements: [{ year: reachedYear, label: definition(id).title }],
    });
  }
  const project = opts.projected;
  const expected =
    input.projection && project
      ? firstProjectedYear(
          input.projection.years,
          input.asOfYear,
          (y) => project(y) >= target,
        )
      : null;
  return result(id, {
    status:
      !input.projection || !project
        ? "unknown"
        : expected
          ? "onTrack"
          : "behind",
    value,
    target: targetValue,
    progress: Math.max(0, Math.min(1, safeDivide(current, target, 0))),
    headline,
    note: project ? expectedNote(expected, input, opts.estimate) : null,
    nextStep: `${formatCurrency(target - current)} to go`,
    expectedYear: expected?.year ?? null,
    expectedAge: expected?.age ?? null,
  });
}

/**
 * A "growth beats a year's figure" milestone (investments save harder than
 * you, money works harder than you). It's about a whole year, so it's
 * judged on what happened: a finalized year's recorded gain against that
 * year's figure. Nothing has happened yet for this year or later ones, so
 * they use the napkin rate — and this year shows as on pace, never
 * reached, until it's finalized. Reached stays reached after a weaker
 * year, like the other achievements.
 */
export function growthMilestone(
  id: "investmentsSaveHarder" | "moneyWorksHarder",
  input: MilestoneInput,
  now: MilestoneYear,
  opts: {
    /** A finalized year's figure; null when not recorded. */
    past: (y: MilestoneYear) => number | null;
    /** This year's figure; null when unknown. */
    current: number | null;
    projected: (y: MilestoneProjectionYear) => number | null;
    /** What the headline calls the figure ("saved", "pay"). */
    label: string;
    /** The next step's ending. */
    matches: string;
  },
): MilestoneResult {
  const beats = (growth: number, figure: number | null) =>
    figure !== null && figure > 0 && growth >= figure;
  const judged = input.years.flatMap((y) => {
    const figure = opts.past(y);
    return !y.isCurrent && y.gain !== null && figure !== null && figure > 0
      ? [{ year: y.year, gain: y.gain, figure }]
      : [];
  });
  const reached = judged.find((y) => beats(y.gain, y.figure)) ?? null;
  const last = judged[judged.length - 1] ?? null;
  const pace = now.liquid * MONEY_GUY_NAPKIN_RETURN;
  const target =
    opts.current !== null && opts.current > 0 ? opts.current : null;
  const onPace = beats(pace, target);
  const expected =
    reached || onPace || !input.projection
      ? null
      : firstProjectedYear(input.projection.years, input.asOfYear, (y) =>
          beats(y.liquid * MONEY_GUY_NAPKIN_RETURN, opts.projected(y)),
        );
  // The latest finalized year when there is one (what happened), else
  // this year's pace.
  const shown: { growth: number; figure: number | null } = last
    ? { growth: last.gain, figure: last.figure }
    : { growth: pace, figure: target };
  return result(id, {
    status: reached
      ? "reached"
      : target === null
        ? "unknown"
        : onPace
          ? "onTrack"
          : !input.projection
            ? "unknown"
            : expected
              ? "onTrack"
              : "behind",
    value: { kind: "currency", amount: shown.growth },
    target:
      shown.figure !== null ? { kind: "currency", amount: shown.figure } : null,
    progress:
      shown.figure !== null
        ? Math.max(0, Math.min(1, safeDivide(shown.growth, shown.figure, 0)))
        : null,
    headline:
      shown.figure !== null
        ? `${last ? `${last.year}: ` : ""}${formatCurrency(shown.growth)} growth vs ${formatCurrency(shown.figure)} ${opts.label}`
        : `${formatCurrency(shown.growth)} growth a year`,
    reachedYear: reached?.year ?? null,
    note: reached
      ? reachedNote(
          reached.year,
          input.years,
          last ? beats(last.gain, last.figure) : true,
        )
      : onPace
        ? `On pace for ${input.asOfYear} · counts once it's finalized in Performance`
        : expectedNote(expected, input),
    nextStep:
      !reached && !onPace && target !== null
        ? `At ${formatCurrency(safeDivide(target, MONEY_GUY_NAPKIN_RETURN, 0))} invested, ${opts.matches}`
        : null,
    expectedYear: onPace ? input.asOfYear : (expected?.year ?? null),
    expectedAge: onPace ? now.age : (expected?.age ?? null),
    achievements: reached
      ? [{ year: reached.year, label: definition(id).title }]
      : [],
  });
}
