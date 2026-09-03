/** Executive-summary section of the advisor report — renders the narrative
 *  paragraph and key numbers lib/pure/report/executive-summary.ts already
 *  computed. Presentational only. */
import type { ReportExecutiveSummary } from "@/lib/pure/report/types";

export function ReportExecutiveSummarySection({
  summary,
}: {
  summary: ReportExecutiveSummary;
}) {
  return (
    <section className="mb-6" style={{ breakInside: "avoid" }}>
      <h2 className="mb-2 text-lg font-semibold">Executive Summary</h2>
      <p className="mb-3 text-sm leading-relaxed">{summary.narrative}</p>
      {summary.coastFireLine && (
        <p className="text-muted mb-3 text-sm">{summary.coastFireLine}</p>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {summary.keyNumbers.map((kn) => (
          <div key={kn.label} className="flex justify-between border-b py-1">
            <dt className="text-muted">{kn.label}</dt>
            <dd className="font-medium tabular-nums">{kn.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
