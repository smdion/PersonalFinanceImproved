/** Orchestrator for the retirement advisor report — mounted by index.tsx
 *  only when `reportMode === "advisor"`, hidden on screen via the caller's
 *  `hidden print:block` wrapper. Builds the narrative once (pure function,
 *  lib/pure/report) and renders each section. Requires a fresh, baseline,
 *  Advanced-tax-mode Monte Carlo result — index.tsx only reaches this
 *  component after `checkReportGate` has passed, so `mcResult` here is
 *  always real, never degraded. */
import type { ProjectionResult } from "@/lib/calculators/types/engine-projection";
import type { MonteCarloResult } from "@/lib/calculators/types/monte-carlo";
import { buildReportNarrative } from "@/lib/pure/report";
import { ReportCover } from "./report-cover";
import { ReportExecutiveSummarySection } from "./report-executive-summary";
import { ReportStrategyNarrativeSection } from "./report-strategy-narrative";
import {
  ReportAssumptionsSummary,
  type ReportEngineSettings,
} from "./report-assumptions-summary";
import { ReportFooter } from "./report-header";

export function ReportRoot({
  projectionResult,
  mcResult,
  deflate,
  baseYear,
  coastFireAge,
  peopleNames,
  generatedAt,
  engineSettings,
  rmdExcessYears,
  qcdYears,
}: {
  projectionResult: ProjectionResult;
  mcResult: MonteCarloResult;
  deflate: (value: number, year: number) => number;
  baseYear: number;
  coastFireAge: number | null;
  peopleNames: string[];
  generatedAt: Date;
  engineSettings: ReportEngineSettings;
  rmdExcessYears: number;
  qcdYears: number;
}) {
  const narrative = buildReportNarrative(projectionResult, mcResult, {
    deflate,
    baseYear,
    coastFireAge,
  });

  return (
    <div>
      <ReportCover
        peopleNames={peopleNames}
        generatedAt={generatedAt}
        verdict={narrative.executiveSummary.verdict}
      />
      <ReportExecutiveSummarySection summary={narrative.executiveSummary} />
      <ReportStrategyNarrativeSection strategy={narrative.withdrawalStrategy} />
      <ReportAssumptionsSummary
        settings={engineSettings}
        rmdExcessYears={rmdExcessYears}
        qcdYears={qcdYears}
      />
      <ReportFooter generatedAt={generatedAt} />
    </div>
  );
}
