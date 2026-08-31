/** Risk-analysis section of the advisor report — the stated centerpiece.
 *  Renders lib/pure/report/risk-narrative.ts's output plus a static,
 *  print-safe percentile-band chart. Presentational only. */
import type {
  RiskNarrative,
  RiskBandPoint,
} from "@/lib/pure/report/risk-narrative";
import { ReportRiskBandChart } from "./report-risk-band-chart";

export function ReportRiskAnalysisSection({
  narrative,
  bandPoints,
  deflate,
}: {
  narrative: RiskNarrative;
  bandPoints: RiskBandPoint[];
  deflate: (value: number, year: number) => number;
}) {
  return (
    <section className="mb-6" style={{ breakInside: "avoid" }}>
      <h2 className="text-lg font-semibold mb-2">Risk Analysis</h2>
      <p className="text-sm leading-relaxed mb-3">
        {narrative.successRateNarrative}
      </p>
      <p className="text-sm leading-relaxed mb-3">
        {narrative.worstCaseNarrative}
      </p>
      {narrative.spendingStabilityNarrative && (
        <p className="text-sm leading-relaxed mb-3">
          {narrative.spendingStabilityNarrative}
        </p>
      )}
      <div className="mb-1">
        <ReportRiskBandChart points={bandPoints} deflate={deflate} />
      </div>
      <p className="text-xs text-muted">
        Shaded range: 10th to 90th percentile portfolio balance across simulated
        market conditions (today&apos;s dollars). Line: median.
      </p>
    </section>
  );
}
