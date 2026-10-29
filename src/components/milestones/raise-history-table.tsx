"use client";

/**
 * Every judged raise under "Save your raises (60/40)": the salary change,
 * the change in the household's own contributions, and the share saved.
 */
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { meetsRaiseRule, type RaiseYear } from "@/lib/pure/raise-history";

export function RaiseHistoryTable({ raises }: { raises: RaiseYear[] }) {
  if (raises.length === 0) return null;
  return (
    <table className="mt-1 mb-1 ml-6 text-xs">
      <thead>
        <tr className="text-faint">
          <th className="pr-4 text-left font-normal">Year</th>
          <th className="pr-4 text-right font-normal">Raise</th>
          <th className="pr-4 text-right font-normal">Saving change</th>
          <th className="text-right font-normal">Saved</th>
        </tr>
      </thead>
      <tbody>
        {[...raises].reverse().map((r) => (
          <tr key={r.year} className="text-muted">
            <td className="pr-4">
              {r.year}
              {r.estimated && <span className="text-faint"> (estimate)</span>}
            </td>
            <td className="pr-4 text-right tabular-nums">
              {formatCurrency(r.raise, 0)}
            </td>
            <td className="pr-4 text-right tabular-nums">
              {r.savingChange < 0 ? "−" : "+"}
              {formatCurrency(Math.abs(r.savingChange), 0)}
            </td>
            <td
              className={`text-right tabular-nums ${meetsRaiseRule(r) ? "text-green-600" : "text-amber-600"}`}
            >
              {formatPercent(r.share, 0)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
