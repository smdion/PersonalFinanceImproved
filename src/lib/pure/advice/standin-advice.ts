/**
 * Whether to use a suggested stand-in for a plan-only fund: yes when its SEC filings explain
 * most of it, else the plan's fact sheet. Fees always point to the plan's fee disclosure.
 */
import type { StandInPreview } from "@/lib/config/enum-values";

/** Share of the stand-in's holdings its filings must classify to trust its mix. */
export const STANDIN_COVERAGE_OK = 0.9;

type StandInAdvice =
  | { mix: "checking" }
  | { mix: "use"; coverage: number }
  | {
      mix: "enter";
      /** Null when the stand-in files no holdings report at all. */
      coverage: number | null;
    };

export function adviseStandIn(preview: StandInPreview | null): StandInAdvice {
  // Never checked, or the checks so far failed before finding anything.
  if (!preview || (preview.error && preview.coverage === null))
    return { mix: "checking" };
  if (preview.coverage === null) return { mix: "enter", coverage: null };
  return preview.coverage >= STANDIN_COVERAGE_OK
    ? { mix: "use", coverage: preview.coverage }
    : { mix: "enter", coverage: preview.coverage };
}
