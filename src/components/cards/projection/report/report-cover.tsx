/** Cover section of the advisor report: title/date (reuses ReportHeader)
 *  plus a plan-verdict badge. Print-only, presentational — the verdict
 *  itself is computed by lib/pure/report/executive-summary.ts, never
 *  re-derived here. */
import type { ReportVerdict } from "@/lib/pure/report/types";
import { ReportHeader } from "./report-header";

export function ReportCover({
  peopleNames,
  generatedAt,
  verdict,
}: {
  peopleNames: string[];
  generatedAt: Date;
  verdict: ReportVerdict;
}) {
  return (
    <div>
      <ReportHeader peopleNames={peopleNames} generatedAt={generatedAt} />
      <div
        className={`inline-block rounded px-3 py-1.5 text-sm font-medium ${
          verdict.onTrack
            ? "bg-green-50 text-green-700 border border-green-200"
            : "bg-amber-50 text-amber-700 border border-amber-200"
        }`}
      >
        {verdict.headline}
      </div>
    </div>
  );
}
