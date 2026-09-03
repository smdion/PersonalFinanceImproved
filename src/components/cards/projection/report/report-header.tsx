import { formatDate } from "@/lib/utils/format";

/** Print-only cover header for the retirement advisor report.
 *  Mounted only when reportMode === "advisor" (see index.tsx) — hidden on
 *  screen, visible when printing, via the `hidden print:block` wrapper the
 *  caller applies. Presentational only, no data fetching of its own. */
export function ReportHeader({
  peopleNames,
  generatedAt,
}: {
  peopleNames: string[];
  generatedAt: Date;
}) {
  return (
    <div className="mb-4 border-b pb-3">
      <h1 className="text-2xl font-semibold">Retirement Projection Report</h1>
      <div className="text-muted mt-1 text-sm">
        {peopleNames.length > 0 && <span>{peopleNames.join(" & ")} — </span>}
        Generated {formatDate(generatedAt, "long")}
      </div>
    </div>
  );
}

/** Print-only footer disclaimer — pairs with `ReportHeader`, rendered once
 *  at the end of the advisor report. Extended (2026-08-31, Phase 4) to
 *  cover the risk-analysis section's methodology now that this report
 *  makes probability claims — the original one-sentence disclaimer
 *  predates that section and only covered the deterministic assumptions. */
export function ReportFooter({ generatedAt }: { generatedAt: Date }) {
  return (
    <div className="text-faint mt-6 space-y-1 border-t pt-3 text-xs">
      <p>
        This report is an estimate based on the assumptions listed above. It is
        not financial, tax, or legal advice.
      </p>
      <p>
        The risk analysis in this report is based on a simulation of many
        possible sequences of market returns, using the return and volatility
        assumptions shown in the assumptions section. Past performance does not
        guarantee future results, and actual outcomes will differ from every
        scenario this report tested.
      </p>
      <p>Generated {generatedAt.toISOString()}.</p>
    </div>
  );
}
