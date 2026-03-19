"use client";

import React from "react";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { AnnualRow, YoYComparisonProps } from "./types";

export function YoYComparison({ years, data }: YoYComparisonProps) {
  const sortedYears = Array.from(years).sort((a, b) => a - b);
  const rows = sortedYears
    .map((y) => data.find((r) => r.year === y))
    .filter(Boolean) as AnnualRow[];
  if (rows.length < 2) return null;

  const metrics: {
    label: string;
    getValue: (r: AnnualRow) => number;
    format: (v: number) => string;
    colorize?: boolean;
  }[] = [
    {
      label: "Beginning Balance",
      getValue: (r) => r.beginningBalance,
      format: formatCurrency,
    },
    {
      label: "Contributions",
      getValue: (r) => r.totalContributions,
      format: formatCurrency,
    },
    {
      label: "Employer Contrib",
      getValue: (r) => r.employerContributions,
      format: formatCurrency,
    },
    {
      label: "Distributions",
      getValue: (r) => r.distributions,
      format: formatCurrency,
    },
    { label: "Fees", getValue: (r) => r.fees, format: formatCurrency },
    {
      label: "Gain/Loss",
      getValue: (r) => r.yearlyGainLoss,
      format: formatCurrency,
      colorize: true,
    },
    {
      label: "Ending Balance",
      getValue: (r) => r.endingBalance,
      format: formatCurrency,
    },
    {
      label: "Return %",
      getValue: (r) => r.annualReturnPct ?? 0,
      format: (v) => formatPercent(v, 1),
      colorize: true,
    },
  ];

  return (
    <div className="mt-6 bg-surface-primary rounded-lg border border-indigo-200 shadow-sm overflow-x-auto">
      <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-200">
        <h3 className="text-sm font-semibold text-indigo-900">
          Year-over-Year Comparison
        </h3>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-surface-sunken">
            <th className="text-left px-4 py-2 text-muted font-medium">
              Metric
            </th>
            {rows.map((r) => (
              <th
                key={r.year}
                className="text-right px-4 py-2 font-semibold text-primary"
              >
                {r.year}
              </th>
            ))}
            {rows.length === 2 && (
              <th className="text-right px-4 py-2 text-muted font-medium">
                Change
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => {
            const values = rows.map((r) => m.getValue(r));
            const change = rows.length === 2 ? values[1]! - values[0]! : null;
            return (
              <tr key={m.label} className="border-b border-subtle">
                <td className="px-4 py-2 text-muted">{m.label}</td>
                {values.map((v, i) => (
                  <td
                    key={i}
                    className={`text-right px-4 py-2 font-medium ${
                      m.colorize
                        ? v >= 0
                          ? "text-green-600"
                          : "text-red-600"
                        : ""
                    }`}
                  >
                    {m.format(v)}
                  </td>
                ))}
                {change !== null && (
                  <td
                    className={`text-right px-4 py-2 text-sm ${change >= 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {change >= 0 ? "+" : ""}
                    {m.format(change)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
