/** Simplified year-by-year table for the advisor report — see
 *  lib/pure/report/year-table.ts. Presentational only. */
import type { YearTableRow } from "@/lib/pure/report/year-table";

export function ReportYearTable({ rows }: { rows: YearTableRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold mb-2">Year-by-Year Detail</h2>
      <p className="text-xs text-muted mb-2">
        Withdrawal and tax figures in today&apos;s dollars. Full per-account
        detail is available in the app.
      </p>
      <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr className="border-b">
            <th className="text-left py-1 pr-2">Year</th>
            <th className="text-left py-1 pr-2">Age</th>
            <th className="text-right py-1 pr-2">Withdrawal</th>
            <th className="text-right py-1 pr-2">Tax</th>
            <th className="text-left py-1">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.year}
              className="border-b border-subtle"
              style={{ breakInside: "avoid" }}
            >
              <td className="py-0.5 pr-2 tabular-nums">{row.year}</td>
              <td className="py-0.5 pr-2 tabular-nums">{row.age}</td>
              <td className="py-0.5 pr-2 tabular-nums text-right">
                {row.withdrawal}
              </td>
              <td className="py-0.5 pr-2 tabular-nums text-right">
                {row.taxCost}
              </td>
              <td className="py-0.5 text-muted">{row.flags.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
