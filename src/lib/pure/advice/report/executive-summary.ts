/** Advisor report executive summary: plan verdict, key numbers and a short narrative.
 *  Pure, with all formatting decided here. */
import {
  assessPlan,
  describePlanFailure,
} from "@/lib/pure/retirement/plan-outcome";
import type { ProjectionResult } from "@/lib/pure/engine/types/index";
import type { MonteCarloResult } from "@/lib/pure/simulation/monte-carlo.types";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { ReportExecutiveSummary, ReportVerdict } from "./types";

/** Below this simulation success rate the plan "needs attention" even when the
 *  deterministic run never depletes. */
const SUCCESS_RATE_ON_TRACK_THRESHOLD = 0.85;

export function buildVerdict(
  projectionResult: ProjectionResult,
  mcResult: MonteCarloResult,
): ReportVerdict {
  const deterministicOnTrack = assessPlan(projectionResult).succeeded;
  const simulationOnTrack =
    mcResult.successRate >= SUCCESS_RATE_ON_TRACK_THRESHOLD;
  const onTrack = deterministicOnTrack && simulationOnTrack;
  return {
    onTrack,
    headline: onTrack
      ? "Your projection is on track"
      : "Your projection needs attention",
  };
}

export function buildExecutiveSummary(
  projectionResult: ProjectionResult,
  mcResult: MonteCarloResult,
  opts: {
    coastFireAge?: number | null;
  },
): ReportExecutiveSummary {
  const verdict = buildVerdict(projectionResult, mcResult);
  const outcome = assessPlan(projectionResult);

  const successPercent = formatPercent(mcResult.successRate, 0);
  const sustainablePV = formatCurrency(
    mcResult.distributions.sustainableWithdrawalPV.median,
  );

  const keyNumbers: { label: string; value: string }[] = [
    { label: "Simulation success rate", value: successPercent },
    {
      label: "Sustainable annual spending (today's dollars)",
      value: sustainablePV,
    },
  ];

  if (!outcome.succeeded) {
    keyNumbers.push({
      label:
        outcome.failureReason === "depleted"
          ? "Year retirement money runs out"
          : "Year the projection first falls short",
      value: String(outcome.failureYear),
    });
  }

  let narrative: string;
  if (verdict.onTrack) {
    narrative =
      `Based on your current savings and Retirement budget, your simulation succeeds ${successPercent} of the time — ` +
      `your retirement money is not projected to run out in the deterministic projection, and a sustainable annual ` +
      `spending level of about ${sustainablePV} (in today's dollars) holds up across most of the market ` +
      `conditions this report tested.`;
  } else if (!outcome.succeeded) {
    narrative =
      `Your simulation succeeds ${successPercent} of the time. In the deterministic projection — a single, ` +
      `middle-of-the-road path — your projection ${describePlanFailure(outcome)}. ` +
      `This is worth addressing before you rely on this projection.`;
  } else {
    narrative =
      `Your deterministic projection funds every retirement year, but your simulation only succeeds ` +
      `${successPercent} of the time — meaning a meaningful share of the market conditions this report tested ` +
      `end less favorably than the single deterministic path shown elsewhere in this report. Worth a closer look.`;
  }

  const coastFireLine =
    opts.coastFireAge != null
      ? `Coast FIRE age: ${opts.coastFireAge} — you could stop contributing at this age and still reach your goal.`
      : undefined;

  return {
    verdict,
    narrative,
    keyNumbers,
    coastFireLine,
  };
}
