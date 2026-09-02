/** Risk / Monte Carlo section of the advisor report — the stated
 *  centerpiece. Pure functions: no React, no chart library — the
 *  percentile-band data is shaped here for a static, print-safe SVG the
 *  component layer renders (no Recharts/canvas at print time). */
import type { MonteCarloResult } from "@/lib/calculators/types/monte-carlo";
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

export function buildRiskNarrative(
  mcResult: MonteCarloResult,
  opts: { deflate: (v: number, year: number) => number; baseYear: number },
): RiskNarrative {
  const successPct = formatPercent(mcResult.successRate, 0);
  const onTrack = mcResult.successRate >= SUCCESS_RATE_ON_TRACK_THRESHOLD;

  const successRateNarrative = onTrack
    ? `This report tested your plan against many different sequences of market returns. Your plan succeeded — meaning your portfolio lasted through the end of the projection — in ${successPct} of those trials. This is a strong result: most plans that succeed less than 85% of the time have a real, addressable weak point.`
    : `This report tested your plan against many different sequences of market returns. Your plan succeeded — meaning your portfolio lasted through the end of the projection — in only ${successPct} of those trials. This is below the 85% threshold this report treats as "on track," and is worth addressing rather than relying on the single middle-of-the-road projection shown elsewhere in this report.`;

  const worstCase = mcResult.worstCase;
  let worstCaseNarrative: string;
  if (worstCase.p5DepletionAge != null) {
    worstCaseNarrative = `In the worst 5% of market conditions this report tested, your portfolio is projected to be depleted by age ${worstCase.p5DepletionAge}. This is the kind of outcome a genuinely bad decade of market returns — not a typical one — could produce.`;
  } else {
    const p5Balance = formatCurrency(
      opts.deflate(worstCase.p5EndBalance, opts.baseYear),
    );
    worstCaseNarrative = `Even in the worst 5% of market conditions this report tested, your portfolio was not projected to run out — ending with roughly ${p5Balance} (today's dollars) at the end of the projection in that scenario.`;
  }

  const spendingStabilityNarrative =
    mcResult.spendingStabilityRate < 0.85
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
  return mcResult.percentileBands.map((b) => ({
    year: b.year,
    age: b.age,
    low: b.p10,
    high: b.p90,
    median: b.p50,
  }));
}
