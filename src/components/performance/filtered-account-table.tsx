"use client";

import React from "react";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

type FilteredYearRow = {
  year: number;
  beginBal: number;
  contribs: number;
  gainLoss: number;
  endBal: number;
  employer: number;
  distributions: number;
  fees: number;
  rollovers: number;
  returnPct: number | null;
};

/**
 * Read-only per-year table for an ad hoc account selection — the custom
 * filter isn't a stored category, so there's no lifetime/edit machinery to
 * hook up here (unlike performance-table.tsx, which renders real stored
 * annual rows and supports inline editing).
 */
export function FilteredAccountTable({ rows }: { rows: FilteredYearRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-muted py-4 text-center text-sm">
        No performance data for the selected accounts and years.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted border-b text-left">
            <th className="py-2 pr-3 font-medium">Year</th>
            <th className="py-2 pr-3 text-right font-medium">Beginning</th>
            <th className="py-2 pr-3 text-right font-medium">Contributions</th>
            <th className="py-2 pr-3 text-right font-medium">Gain/Loss</th>
            <th className="py-2 pr-3 text-right font-medium">Ending</th>
            <th className="py-2 text-right font-medium">Return</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr key={r.year} className="border-subtle border-b">
              <td className="text-primary py-1.5 pr-3 font-medium">{r.year}</td>
              <td className="text-secondary py-1.5 pr-3 text-right tabular-nums">
                {formatCurrency(r.beginBal)}
              </td>
              <td className="text-secondary py-1.5 pr-3 text-right tabular-nums">
                {formatCurrency(r.contribs)}
              </td>
              <td
                className={`py-1.5 pr-3 text-right font-medium tabular-nums ${
                  r.gainLoss >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {formatCurrency(r.gainLoss)}
              </td>
              <td className="text-primary py-1.5 pr-3 text-right font-semibold tabular-nums">
                {formatCurrency(r.endBal)}
              </td>
              <td
                className={`py-1.5 text-right font-medium tabular-nums ${
                  r.returnPct === null
                    ? "text-faint"
                    : r.returnPct >= 0
                      ? "text-green-600"
                      : "text-red-600"
                }`}
              >
                {r.returnPct === null ? "—" : formatPercent(r.returnPct, 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
