/** Risk / Monte Carlo section of the advisor report — the stated
 *  centerpiece. Pure functions: no React, no chart library — the
 *  percentile-band data is shaped here for a static, print-safe SVG the
 *  component layer renders (no Recharts/canvas at print time). */
import type { MonteCarloResult } from "@/lib/pure/simulation/monte-carlo.types";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

export interface RiskNarrative {
  successRateNarrative: string;
  worstCaseNarrative: string;
  /** Only present when the deterministic worst-case depletion age exists —
   *  a plan whose worst 5% of trials never deplete has nothing to say
   *  here beyond the success-rate framing above. */
  spendingStabilityNarrative?: string;
}

/** Below this, the success-rate narrative should name the number plainly
 *  rather than soften it — matches executive-summary.ts's own bar so the
 *  two sections never disagree about whether a rate "sounds fine." */
const SUCCESS_RATE_ON_TRACK_THRESHOLD = 0.85;

/** Below this spending stability rate, the narrative notes the deep cuts. */
const SPENDING_STABILITY_NOTE_BELOW = 0.85;

export function buildRiskNarrative(mcResult: MonteCarloResult): RiskNarrative {
  const successPercent = formatPercent(mcResult.successRate, 0);
  const onTrack = mcResult.successRate >= SUCCESS_RATE_ON_TRACK_THRESHOLD;

  const successRateNarrative = onTrack
    ? `This report tested your projection against many different sequences of market returns. Your projection succeeded — meaning every retirement year was funded — in ${successPercent} of those trials. This is a strong result: most plans that succeed less than 85% of the time have a real, addressable weak point.`
    : `This report tested your projection against many different sequences of market returns. Your projection succeeded — meaning every retirement year was funded — in only ${successPercent} of those trials. This is below the 85% threshold this report treats as "on track," and is worth addressing rather than relying on the single middle-of-the-road projection shown elsewhere in this report.`;

  const worstCase = mcResult.worstCase;
  let worstCaseNarrative: string;
  if (worstCase.p5FailureAge != null) {
    worstCaseNarrative = `In the worst 5% of market conditions this report tested, your projection falls short by age ${worstCase.p5FailureAge}. This is the kind of outcome a genuinely bad decade of market returns — not a typical one — could produce.`;
  } else {
    // Today's dollars from the Simulation itself — each trial deflated by
    // its own inflation (deflating the nominal figure at the base year was
    // a no-op that printed future dollars as today's).
    const p5Balance = formatCurrency(mcResult.today.p5EndBalance);
    worstCaseNarrative = `Even in the worst 5% of market conditions this report tested, your retirement money was not projected to run out — ending with roughly ${p5Balance} (today's dollars) at the end of the projection in that scenario.`;
  }

  const spendingStabilityNarrative =
    mcResult.spendingStabilityRate < SPENDING_STABILITY_NOTE_BELOW
      ? `Beyond whether your money lasts, ${formatPercent(1 - mcResult.spendingStabilityRate, 0)} of trials required cutting your spending by more than 25% below your planned level at some point along the way — worth knowing even in scenarios that technically "succeed."`
      : undefined;

  return {
    successRateNarrative,
    worstCaseNarrative,
    spendingStabilityNarrative,
  };
}

export interface RiskBandPoint {
  year: number;
  age: number;
  low: number;
  high: number;
  median: number;
}

/** Shapes percentile-band data for a static print SVG: p10-p90 as the
 *  shaded range, p50 as the line — same convention the interactive fan
 *  chart uses for its default band width, just fixed (no user-adjustable
 *  band range in the printed report). */
export function buildRiskBandPoints(
  mcResult: MonteCarloResult,
): RiskBandPoint[] {
  // Today's dollars (the report's), deflated per trial by the Simulation.
  return mcResult.today.percentileBands.map((b) => ({
    year: b.year,
    age: b.age,
    low: b.p10,
    high: b.p90,
    median: b.p50,
  }));
}
