/** Executive-summary section of the retirement advisor report: plan
 *  verdict, key numbers, and a short narrative paragraph. Pure function —
 *  no React, no formatting decisions left to the component layer, so
 *  correctness is testable without a DOM. */
import {
  assessPlan,
  describePlanFailure,
} from "@/lib/calculators/plan-outcome";
import type { ProjectionResult } from "@/lib/calculators/types/engine-projection";
import type { MonteCarloResult } from "@/lib/calculators/types/monte-carlo";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { ReportExecutiveSummary, ReportVerdict } from "./types";

/** Below this Monte Carlo success rate, the plan reads as "needs
 *  attention" even if the deterministic projection never depletes —
 *  the deterministic run is one path among many; a low success rate
 *  means most of the OTHER paths don't end as well. */
const SUCCESS_RATE_ON_TRACK_THRESHOLD = 0.85;

export function buildVerdict(
  projectionResult: ProjectionResult,
  mcResult: MonteCarloResult,
): ReportVerdict {
  const deterministicOnTrack = assessPlan(projectionResult).succeeded;
  const mcOnTrack = mcResult.successRate >= SUCCESS_RATE_ON_TRACK_THRESHOLD;
  const onTrack = deterministicOnTrack && mcOnTrack;
  return {
    onTrack,
    headline: onTrack ? "Your plan is on track" : "Your plan needs attention",
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

  const successPct = formatPercent(mcResult.successRate, 0);
  const sustainablePV = formatCurrency(
    mcResult.distributions.sustainableWithdrawalPV.median,
  );

  const keyNumbers: { label: string; value: string }[] = [
    { label: "Simulation success rate", value: successPct },
    {
      label: "Sustainable annual spending (today's dollars)",
      value: sustainablePV,
    },
  ];

  if (!outcome.succeeded) {
    keyNumbers.push({
      label:
        outcome.failureReason === "depleted"
          ? "Age retirement money runs out"
          : "Age the plan first falls short",
      value: String(outcome.failureAge),
    });
  }

  let narrative: string;
  if (verdict.onTrack) {
    narrative =
      `Based on your current savings and spending plan, your simulation succeeds ${successPct} of the time — ` +
      `your retirement money is not projected to run out in the deterministic projection, and a sustainable annual ` +
      `spending level of about ${sustainablePV} (in today's dollars) holds up across most of the market ` +
      `conditions this report tested.`;
  } else if (!outcome.succeeded) {
    narrative =
      `Your simulation succeeds ${successPct} of the time. In the deterministic projection — a single, ` +
      `middle-of-the-road path — your plan ${describePlanFailure(outcome)}. ` +
      `This is worth addressing before you rely on this plan.`;
  } else {
    narrative =
      `Your deterministic projection funds every retirement year, but your simulation only succeeds ` +
      `${successPct} of the time — meaning a meaningful share of the market conditions this report tested ` +
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
