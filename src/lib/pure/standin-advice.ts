/**
 * Should the household use a suggested stand-in fund for a plan-only fund?
 * Pure. Judged from the stand-in's own SEC filings (its preview): if they
 * explain most of the fund, its mix is a good stand-in; if not (e.g. a
 * fund that holds its investments through master funds the filings don't
 * break down), the plan's fund fact sheet is better. The fee is never the
 * stand-in's — a retail fee isn't the plan's — so the advice always points
 * to the plan's fee disclosure for it.
 */
import type { StandInPreview } from "@/lib/config/enum-values";

/** Share of the stand-in's holdings its filings must classify to trust its mix. */
export const STANDIN_COVERAGE_OK = 0.9;

export type StandInAdvice =
  | { mix: "checking" }
  | { mix: "use"; coverage: number }
  | {
      mix: "enter";
      /** Null when the stand-in files no holdings report at all. */
      coverage: number | null;
    };

export function adviseStandIn(preview: StandInPreview | null): StandInAdvice {
  if (!preview) return { mix: "checking" };
  if (preview.coverage === null) return { mix: "enter", coverage: null };
  return preview.coverage >= STANDIN_COVERAGE_OK
    ? { mix: "use", coverage: preview.coverage }
    : { mix: "enter", coverage: preview.coverage };
}
