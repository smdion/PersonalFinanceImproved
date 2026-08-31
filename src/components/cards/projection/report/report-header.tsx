/** Print-only cover header for the "fancy" retirement projection report (R42).
 *  Mounted only when reportMode === "fancy" (see index.tsx) — hidden on
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
      <div className="mt-1 text-sm text-muted">
        {peopleNames.length > 0 && <span>{peopleNames.join(" & ")} — </span>}
        Generated{" "}
        {generatedAt.toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </div>
    </div>
  );
}

/** Print-only footer disclaimer — pairs with `ReportHeader`, rendered once
 *  at the end of the fancy report. */
export function ReportFooter({ generatedAt }: { generatedAt: Date }) {
  return (
    <div className="mt-6 border-t pt-3 text-xs text-faint">
      This report is an estimate based on the assumptions listed above. It is
      not financial, tax, or legal advice. Generated {generatedAt.toISOString()}
      .
    </div>
  );
}
