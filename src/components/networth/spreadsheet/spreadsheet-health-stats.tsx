"use client";

/** Financial Health Stats table — compact two-column comparison of wealth metrics.
 *  All metrics are pre-computed by buildYearEndHistory (single computation path). */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { formatPercent } from "@/lib/utils/format";
import { PERFORMANCE_STALE_DAYS } from "@/lib/constants";
import {
  projectFIYear,
  formatFIProjection,
} from "@/lib/calculators/fi-projection";
import type { DetailedHistoryRow } from "./types";

type Props = {
  yearA: DetailedHistoryRow;
  yearB: DetailedHistoryRow;
};

type RowDef = {
  label: string;
  format: (value: number) => string;
  accessor: (row: DetailedHistoryRow) => number;
  isFlowMetric: boolean;
};

const STAT_ROWS: RowDef[] = [
  {
    label: "Wealth Score",
    format: (v) => `${(v * 100).toFixed(0)}%`,
    accessor: (r) => r.wealthScore,
    isFlowMetric: false,
  },
  {
    label: "AAW Score",
    format: (v) => v.toFixed(1),
    accessor: (r) => r.aawScore,
    isFlowMetric: false,
  },
  {
    label: "Brokerage/ESPP Contribution Rate",
    format: (v) => formatPercent(v, 1),
    accessor: (r) => {
      const cat = r.performanceByCategory["Brokerage"];
      if (!cat || r.grossIncome <= 0) return 0;
      return cat.contributions / r.grossIncome;
    },
    isFlowMetric: true,
  },
  {
    label: "Retirement Contribution Rate",
    format: (v) => formatPercent(v, 1),
    accessor: (r) => {
      const cat = r.performanceByCategory["401k/IRA"];
      if (!cat || r.grossIncome <= 0) return 0;
      return (cat.contributions + cat.employerMatch) / r.grossIncome;
    },
    isFlowMetric: true,
  },
  {
    label: "Portfolio Contribution Rate",
    format: (v) => formatPercent(v, 1),
    accessor: (r) => {
      if (!r.perfContributions || r.grossIncome <= 0) return 0;
      return r.perfContributions / r.grossIncome;
    },
    isFlowMetric: true,
  },
];

export function SpreadsheetHealthStats({ yearA, yearB }: Props) {
  const fiProjection = useMemo(
    () =>
      projectFIYear(yearA.fiProgress, yearB.fiProgress, yearA.year, yearB.year),
    [yearA.fiProgress, yearB.fiProgress, yearA.year, yearB.year],
  );

  const hasCurrentYear = yearA.isCurrent || yearB.isCurrent;

  const staleCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - PERFORMANCE_STALE_DAYS);
    return d.toISOString();
  }, []);
  const isOutdatedA =
    yearA.isCurrent &&
    (!yearA.perfLastUpdated || yearA.perfLastUpdated < staleCutoff);
  const isOutdatedB =
    yearB.isCurrent &&
    (!yearB.perfLastUpdated || yearB.perfLastUpdated < staleCutoff);

  return (
    <Card title="Financial Health Stats" className="mb-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1.5 pr-2 text-muted font-medium" />
              <th className="text-right py-1.5 px-2 text-muted font-medium w-24">
                {yearA.year}
              </th>
              <th className="text-right py-1.5 pl-2 text-muted font-medium w-24">
                {yearB.year}
              </th>
            </tr>
          </thead>
          <tbody>
            {STAT_ROWS.map((row) => {
              const valA = row.accessor(yearA);
              const valB = row.accessor(yearB);
              return (
                <tr key={row.label} className="border-b border-subtle">
                  <td className="py-1.5 pr-2 font-medium text-secondary">
                    {row.label}
                    {hasCurrentYear && (
                      <span className="text-faint font-normal"> - YTD</span>
                    )}
                  </td>
                  <td className="text-right py-1.5 px-2">
                    {row.isFlowMetric && isOutdatedA ? (
                      <span className="text-amber-500 text-[10px]">
                        Outdated
                      </span>
                    ) : (
                      row.format(valA)
                    )}
                  </td>
                  <td className="text-right py-1.5 pl-2">
                    {row.isFlowMetric && isOutdatedB ? (
                      <span className="text-amber-500 text-[10px]">
                        Outdated
                      </span>
                    ) : (
                      row.format(valB)
                    )}
                  </td>
                </tr>
              );
            })}
            {/* FI Progress row */}
            <tr className="border-b border-subtle">
              <td className="py-1.5 pr-2 font-medium text-secondary">
                FI Progress (Budget)
                {hasCurrentYear && (
                  <span className="text-faint font-normal"> - YTD</span>
                )}
              </td>
              <td className="text-right py-1.5 px-2">
                {formatPercent(yearA.fiProgress, 1)}
              </td>
              <td className="text-right py-1.5 pl-2">
                {formatPercent(yearB.fiProgress, 1)}
              </td>
            </tr>
            {/* Projected FI Year row */}
            <tr className="border-b border-subtle">
              <td className="py-1.5 pr-2 font-medium text-secondary">
                Projected FI Year (Budget)
                {hasCurrentYear && (
                  <span className="text-faint font-normal"> - YTD</span>
                )}
              </td>
              <td colSpan={2} className="text-right py-1.5 pl-2 font-medium">
                {formatFIProjection(fiProjection)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
