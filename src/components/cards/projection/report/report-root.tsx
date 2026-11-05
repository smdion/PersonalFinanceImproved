/** Orchestrator for the retirement advisor report — mounted by index.tsx
 *  only when `reportMode === "advisor"`, hidden on screen via the caller's
 *  `hidden print:block` wrapper. Builds the narrative once (pure function,
 *  lib/pure/report) and renders each section. Requires a fresh, baseline,
 *  Advanced-tax-mode Monte Carlo result — index.tsx only reaches this
 *  component after `checkReportGate` has passed, so `mcResult` here is
 *  always real, never degraded. */
import type { ProjectionResult } from "@/lib/pure/engine/types/index";
import type { MonteCarloResult } from "@/lib/pure/simulation/monte-carlo.types";
import type { PerPersonSettings } from "@/components/retirement/sections/types";
import type { BracketOptimizerResult } from "@/lib/pure/retirement/withdrawal-bracket-optimizer";
import { buildReportNarrative } from "@/lib/pure/report";
import { ReportCover } from "./report-cover";
import { ReportExecutiveSummarySection } from "./report-executive-summary";
import { ReportStrategyNarrativeSection } from "./report-strategy-narrative";
import { ReportRiskAnalysisSection } from "./report-risk-analysis";
import { ReportRiskWatchlistSection } from "./report-risk-watchlist";
import { ReportActionItemsSection } from "./report-action-items";
import { ReportYearTable } from "./report-year-table";
import {
  ReportAssumptionsSummary,
  type ReportEngineSettings,
} from "./report-assumptions-summary";
import { ReportFooter } from "./report-header";

export function ReportRoot({
  projectionResult,
  mcResult,
  deflate,
  coastFireAge,
  peopleNames,
  generatedAt,
  engineSettings,
  perPersonSettings,
  rmdExcessYears,
  qcdYears,
  irmaaCappedRothYears,
  bracketOptimizerResult,
}: {
  projectionResult: ProjectionResult;
  mcResult: MonteCarloResult;
  deflate: (value: number, year: number) => number;
  coastFireAge: number | null;
  peopleNames: string[];
  generatedAt: Date;
  engineSettings: ReportEngineSettings;
  perPersonSettings?: NonNullable<PerPersonSettings>;
  rmdExcessYears: number;
  qcdYears: number;
  irmaaCappedRothYears: number;
  bracketOptimizerResult?: BracketOptimizerResult | null;
}) {
  const narrative = buildReportNarrative(projectionResult, mcResult, {
    deflate,
    coastFireAge,
    bracketOptimizerResult,
  });

  return (
    <div>
      <ReportCover
        peopleNames={peopleNames}
        generatedAt={generatedAt}
        verdict={narrative.executiveSummary.verdict}
      />
      <ReportExecutiveSummarySection summary={narrative.executiveSummary} />
      <ReportRiskAnalysisSection
        narrative={narrative.risk}
        bandPoints={narrative.riskBandPoints}
      />
      <ReportStrategyNarrativeSection strategy={narrative.withdrawalStrategy} />
      <ReportRiskWatchlistSection watchlist={narrative.watchlist} />
      <ReportActionItemsSection actionItems={narrative.actionItems} />
      <div style={{ pageBreakBefore: "always" }}>
        <ReportYearTable rows={narrative.yearTableRows} />
      </div>
      <ReportAssumptionsSummary
        settings={engineSettings}
        perPersonSettings={perPersonSettings}
        rmdExcessYears={rmdExcessYears}
        qcdYears={qcdYears}
        irmaaCappedRothYears={irmaaCappedRothYears}
      />
      <ReportFooter generatedAt={generatedAt} />
    </div>
  );
}
