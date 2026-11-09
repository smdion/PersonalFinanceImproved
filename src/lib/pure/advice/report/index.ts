/** Orchestrator for the retirement advisor report's narrative content —
 *  combines the individual section builders into one `ReportNarrative`.
 *  Pure function: same inputs, same output, no React, no side effects. */
import type { ProjectionResult } from "@/lib/pure/engine/types/index";
import type { MonteCarloResult } from "@/lib/pure/simulation/monte-carlo.types";
import type { BracketOptimizerResult } from "@/lib/pure/retirement/withdrawal-bracket-optimizer";
import { buildExecutiveSummary } from "./executive-summary";
import { buildWithdrawalStrategyNarrative } from "./withdrawal-strategy-narrative";
import { buildRiskNarrative, buildRiskBandPoints } from "./risk-narrative";
import { buildWatchlist } from "./aca-irmaa-narrative";
import { buildActionItems } from "./action-items";
import { buildYearTableRows } from "./year-table";
import type { ReportNarrative } from "./types";
/**
 * The full advisor-report narrative. Call only after `checkReportGate` passes: it guarantees
 * the fresh `mcResult` this requires.
 */
export function buildReportNarrative(
  projectionResult: ProjectionResult,
  mcResult: MonteCarloResult,
  opts: {
    deflate: (value: number, year: number) => number;
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

  const risk = buildRiskNarrative(mcResult);
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
