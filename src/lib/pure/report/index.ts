/** Orchestrator for the retirement advisor report's narrative content —
 *  combines the individual section builders into one `ReportNarrative`.
 *  Pure function: same inputs, same output, no React, no side effects. */
import type { ProjectionResult } from "@/lib/calculators/types/engine-projection";
import type { MonteCarloResult } from "@/lib/calculators/types/monte-carlo";
import type { BracketOptimizerResult } from "@/lib/calculators/withdrawal-bracket-optimizer";
import { buildExecutiveSummary } from "./executive-summary";
import { buildWithdrawalStrategyNarrative } from "./withdrawal-strategy-narrative";
import { buildRiskNarrative, buildRiskBandPoints } from "./risk-narrative";
import { buildWatchlist } from "./aca-irmaa-narrative";
import { buildActionItems } from "./action-items";
import { buildYearTableRows } from "./year-table";
import type { ReportNarrative } from "./types";

export type { ReportNarrative } from "./types";
export { checkReportGate, reportGateFailureMessage } from "./mc-freshness";
export type {
  ReportGateInput,
  ReportGateResult,
  ReportGateFailure,
} from "./mc-freshness";

/**
 * Build the full advisor-report narrative. Callers should only invoke this
 * after `checkReportGate` has passed — `mcResult` is required (not
 * optional) precisely because the gate guarantees a fresh one exists by
 * the time this runs; this function does not itself degrade gracefully
 * for a missing/stale MC result.
 */
export function buildReportNarrative(
  projectionResult: ProjectionResult,
  mcResult: MonteCarloResult,
  opts: {
    deflate: (value: number, year: number) => number;
    baseYear: number;
    coastFireAge?: number | null;
    bracketOptimizerResult?: BracketOptimizerResult | null;
  },
): ReportNarrative {
  const executiveSummary = buildExecutiveSummary(projectionResult, mcResult, {
    coastFireAge: opts.coastFireAge,
  });

  const decumulationYears = projectionResult.projectionByYear.filter(
    (y) => y.phase === "decumulation",
  );
  const withdrawalStrategy = buildWithdrawalStrategyNarrative(
    decumulationYears,
    opts.deflate,
    opts.bracketOptimizerResult,
  );

  const risk = buildRiskNarrative(mcResult, {
    deflate: opts.deflate,
    baseYear: opts.baseYear,
  });
  const riskBandPoints = buildRiskBandPoints(mcResult);

  const watchlist = buildWatchlist(decumulationYears, opts.deflate);
  const actionItems = buildActionItems(
    projectionResult,
    mcResult,
    decumulationYears,
  );
  const yearTableRows = buildYearTableRows(decumulationYears, opts.deflate);

  return {
    executiveSummary,
    withdrawalStrategy,
    risk,
    riskBandPoints,
    watchlist,
    actionItems,
    yearTableRows,
  };
}
