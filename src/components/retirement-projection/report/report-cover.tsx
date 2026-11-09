/** Advisor report cover: title/date (via ReportHeader) plus a plan-verdict
 *  badge. The verdict comes from lib/pure/advice/report/executive-summary.ts. */
import type { ReportVerdict } from "@/lib/pure/advice/report/types";
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
            ? "border border-green-200 bg-green-50 text-green-700"
            : "border border-amber-200 bg-amber-50 text-amber-700"
        }`}
      >
        {verdict.headline}
      </div>
    </div>
  );
}
