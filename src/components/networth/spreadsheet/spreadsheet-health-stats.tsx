"use client";

/** Financial Health Stats table — compact two-column comparison of wealth metrics.
 *  All metrics are pre-computed by buildYearEndHistory (single computation path). */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { PERFORMANCE_STALE_DAYS } from "@/lib/constants";
import {
  projectFIYear,
  formatFIProjection,
} from "@/lib/calculators/fi-projection";
import type { DetailedHistoryRow } from "./types";

type Props = {
  yearA: DetailedHistoryRow;
  yearB: DetailedHistoryRow;
  /** All history rows (for prior-year FI projection reference). */
  allYears: DetailedHistoryRow[];
  /** When true, annualize current-year contribution rates (Projected Year mode). */
  annualize: boolean;
};

type RowDef = {
  label: string;
  format: (value: number) => string;
  accessor: (row: DetailedHistoryRow, annualize: boolean) => number;
  isFlowMetric: boolean;
};

const STAT_ROWS: RowDef[] = [
  {
    label: "Wealth Score",
    format: (v) => `${(v * 100).toFixed(0)}%`,
    accessor: (r, _ann) => r.wealthScore,
    isFlowMetric: false,
  },
  {
    label: "AAW Score",
    format: (v) => v.toFixed(1),
    accessor: (r, _ann) => r.aawScore,
    isFlowMetric: false,
  },
  {
    label: "Brokerage/ESPP Contribution Rate",
    format: (v) => formatPercent(v, 1),
    accessor: (r, ann) => {
      const cat = r.performanceByCategory["Brokerage"];
      if (!cat || r.grossIncome <= 0) return 0;
      const contribs =
        ann && r.isCurrent && r.ytdRatio > 0 && r.ytdRatio < 1
          ? cat.contributions / r.ytdRatio
          : cat.contributions;
      return contribs / r.grossIncome;
    },
    isFlowMetric: true,
  },
  {
    label: "Retirement Contribution Rate",
    format: (v) => formatPercent(v, 1),
    accessor: (r, ann) => {
      const cat = r.performanceByCategory["401k/IRA"];
      if (!cat || r.grossIncome <= 0) return 0;
      const total = cat.contributions + cat.employerMatch;
      const contribs =
        ann && r.isCurrent && r.ytdRatio > 0 && r.ytdRatio < 1
          ? total / r.ytdRatio
          : total;
      return contribs / r.grossIncome;
    },
    isFlowMetric: true,
  },
  {
    label: "Portfolio Contribution Rate",
    format: (v) => formatPercent(v, 1),
    accessor: (r, ann) => {
      if (!r.perfContributions || r.grossIncome <= 0) return 0;
      const contribs =
        ann && r.isCurrent && r.ytdRatio > 0 && r.ytdRatio < 1
          ? r.perfContributions / r.ytdRatio
          : r.perfContributions;
      return contribs / r.grossIncome;
    },
    isFlowMetric: true,
  },
];

export function SpreadsheetHealthStats({
  yearA,
  yearB,
  allYears,
  annualize,
}: Props) {
  const fiProjection = useMemo(
    () =>
      projectFIYear(yearA.fiProgress, yearB.fiProgress, yearA.year, yearB.year),
    [yearA.fiProgress, yearB.fiProgress, yearA.year, yearB.year],
  );

  const hasCurrentYear = yearA.isCurrent || yearB.isCurrent;

  // Prior-year projection: what was the trajectory as of the end of the previous finalized year?
  const priorProjection = useMemo(() => {
    if (!hasCurrentYear) return null;
    const sorted = [...allYears]
      .filter((h) => !h.isCurrent)
      .sort((a, b) => b.year - a.year);
    if (sorted.length < 2) return null;
    const prev = sorted[0]!;
    const prevPrev = sorted[1]!;
    return {
      result: projectFIYear(
        prev.fiProgress,
        prevPrev.fiProgress,
        prev.year,
        prevPrev.year,
      ),
      fromYear: prevPrev.year,
      toYear: prev.year,
    };
  }, [allYears, hasCurrentYear]);

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
            {STAT_ROWS.map((row, index) => {
              const valA = row.accessor(yearA, annualize);
              const valB = row.accessor(yearB, annualize);
              return (
                <tr
                  key={row.label}
                  className={`border-b border-subtle ${index % 2 === 0 ? "bg-surface-sunken/50" : ""}`}
                >
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
            <tr
              className={`border-b border-subtle ${STAT_ROWS.length % 2 === 0 ? "bg-surface-sunken/50" : ""}`}
            >
              <td className="py-1.5 pr-2 font-medium text-secondary">
                FI Progress (Budget)
                {hasCurrentYear && (
                  <span className="text-faint font-normal"> - YTD</span>
                )}
              </td>
              <td className="text-right py-1.5 px-2">
                <div>{formatPercent(yearA.fiProgress, 1)}</div>
                <div className="text-[10px] text-faint">
                  {formatCurrency(yearA.portfolioTotal + yearA.cash)} /{" "}
                  {formatCurrency(yearA.fiTarget)}
                </div>
              </td>
              <td className="text-right py-1.5 pl-2">
                <div>{formatPercent(yearB.fiProgress, 1)}</div>
                <div className="text-[10px] text-faint">
                  {formatCurrency(yearB.portfolioTotal + yearB.cash)} /{" "}
                  {formatCurrency(yearB.fiTarget)}
                </div>
              </td>
            </tr>
            {/* Projected FI Year row */}
            <tr
              className={`border-b border-subtle ${(STAT_ROWS.length + 1) % 2 === 0 ? "bg-surface-sunken/50" : ""}`}
            >
              <td className="py-1.5 pr-2 font-medium text-secondary">
                Projected FI Year (Budget)
                {hasCurrentYear && (
                  <span className="text-faint font-normal"> - YTD</span>
                )}
              </td>
              <td colSpan={2} className="text-right py-1.5 pl-2">
                <div className="font-medium">
                  {formatFIProjection(fiProjection)}
                </div>
                <div className="text-[10px] text-faint">
                  {fiProjection.status === "stalled" && hasCurrentYear
                    ? `FI% YTD ${formatPercent(yearA.fiProgress, 1)} vs ${formatPercent(yearB.fiProgress, 1)} — partial year, may recover`
                    : fiProjection.status === "stalled"
                      ? `FI% declined: ${formatPercent(yearB.fiProgress, 1)} \u2192 ${formatPercent(yearA.fiProgress, 1)}`
                      : fiProjection.status === "projected"
                        ? `${formatPercent((yearA.fiProgress - yearB.fiProgress) / (yearA.year - yearB.year), 1)}/yr pace`
                        : ""}
                </div>
                {priorProjection && (
                  <div className="text-[10px] text-faint">
                    As of {priorProjection.toYear}:{" "}
                    {formatFIProjection(priorProjection.result)}
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
