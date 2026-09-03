/** Simplified year-by-year table for the advisor report — see
 *  lib/pure/report/year-table.ts. Presentational only. */
import type { YearTableRow } from "@/lib/pure/report/year-table";

export function ReportYearTable({ rows }: { rows: YearTableRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-lg font-semibold">Year-by-Year Detail</h2>
      <p className="text-muted mb-2 text-xs">
        Withdrawal and tax figures in today&apos;s dollars. Full per-account
        detail is available in the app.
      </p>
      <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr className="border-b">
            <th className="py-1 pr-2 text-left">Year</th>
            <th className="py-1 pr-2 text-left">Age</th>
            <th className="py-1 pr-2 text-right">Withdrawal</th>
            <th className="py-1 pr-2 text-right">Tax</th>
            <th className="py-1 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.year}
              className="border-subtle border-b"
              style={{ breakInside: "avoid" }}
            >
              <td className="py-0.5 pr-2 tabular-nums">{row.year}</td>
              <td className="py-0.5 pr-2 tabular-nums">{row.age}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums">
                {row.withdrawal}
              </td>
              <td className="py-0.5 pr-2 text-right tabular-nums">
                {row.taxCost}
              </td>
              <td className="text-muted py-0.5">{row.flags.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
