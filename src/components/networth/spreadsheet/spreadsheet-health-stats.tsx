"use client";

/** Financial Health Stats table — compact two-column comparison of wealth metrics.
 *  All metrics are pre-computed by buildYearEndHistory (single computation path). */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { PERFORMANCE_STALE_DAYS } from "@/lib/constants";
import {
  PERF_CATEGORY_DEFAULT,
  PERF_CATEGORY_BROKERAGE,
} from "@/lib/config/display-labels";
import type { DetailedHistoryRow } from "./types";

type SpreadsheetHealthStatsProps = {
  yearA: DetailedHistoryRow;
  yearB: DetailedHistoryRow;
  /** When true, annualize current-year contribution rates (Projected Year mode). */
  annualize: boolean;
  /** When true, use market value scores; when false, use cost basis scores. */
  useMarketValue: boolean;
  /** When true, show stale values instead of "Outdated" label. */
  showOutdated: boolean;
};

type RowDef = {
  label: string;
  format: (value: number) => string;
  accessor: (row: DetailedHistoryRow, annualize: boolean) => number;
  isFlowMetric: boolean;
  /** When set, the accessor above is ignored and this pair of market/cost-basis
   *  accessors is used instead, chosen by the `useMarketValue` toggle. Drives
   *  the Wealth/AAW score rows without branching on `row.label` in the renderer. */
  accessorCostBasis?: {
    market: (row: DetailedHistoryRow) => number;
    costBasis: (row: DetailedHistoryRow) => number;
  };
};

const STAT_ROWS: RowDef[] = [
  {
    label: "Wealth Score",
    format: (v) => formatPercent(v),
    accessor: (r, _ann) => r.wealthScoreMarket,
    isFlowMetric: false,
    accessorCostBasis: {
      market: (r) => r.wealthScoreMarket,
      costBasis: (r) => r.wealthScoreCostBasis,
    },
  },
  {
    label: "AAW Score",
    format: (v) => v.toFixed(1),
    accessor: (r, _ann) => r.aawScoreMarket,
    isFlowMetric: false,
    accessorCostBasis: {
      market: (r) => r.aawScoreMarket,
      costBasis: (r) => r.aawScoreCostBasis,
    },
  },
  {
    label: "Brokerage/ESPP Contribution Rate",
    format: (v) => formatPercent(v, 1),
    accessor: (r, ann) => {
      const cat = r.performanceByCategory[PERF_CATEGORY_BROKERAGE];
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
      const cat = r.performanceByCategory[PERF_CATEGORY_DEFAULT];
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
  annualize,
  useMarketValue,
  showOutdated,
}: SpreadsheetHealthStatsProps) {
  const hasCurrentYear = yearA.isCurrent || yearB.isCurrent;

  const staleCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - PERFORMANCE_STALE_DAYS);
    return d.toISOString();
  }, []);

  function fmtUpdated(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  const isStaleA =
    yearA.isCurrent &&
    (!yearA.perfLastUpdated || yearA.perfLastUpdated < staleCutoff);
  const isStaleB =
    yearB.isCurrent &&
    (!yearB.perfLastUpdated || yearB.perfLastUpdated < staleCutoff);
  const isOutdatedA = isStaleA && !showOutdated;
  const isOutdatedB = isStaleB && !showOutdated;

  return (
    <Card title="Financial Health Stats" className="mb-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1.5 pr-2 text-muted font-medium" />
              <th className="text-right py-1.5 px-2 text-muted font-medium w-24">
                <div>{yearA.year}</div>
                {showOutdated && isStaleA && (
                  <div className="text-caption font-normal text-amber-500">
                    as of {fmtUpdated(yearA.perfLastUpdated) ?? "never synced"}
                  </div>
                )}
              </th>
              <th className="text-right py-1.5 pl-2 text-muted font-medium w-24">
                <div>{yearB.year}</div>
                {showOutdated && isStaleB && (
                  <div className="text-caption font-normal text-amber-500">
                    as of {fmtUpdated(yearB.perfLastUpdated) ?? "never synced"}
                  </div>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {STAT_ROWS.map((row, index) => {
              const valA = row.accessorCostBasis
                ? useMarketValue
                  ? row.accessorCostBasis.market(yearA)
                  : row.accessorCostBasis.costBasis(yearA)
                : row.accessor(yearA, annualize);
              const valB = row.accessorCostBasis
                ? useMarketValue
                  ? row.accessorCostBasis.market(yearB)
                  : row.accessorCostBasis.costBasis(yearB)
                : row.accessor(yearB, annualize);
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
                      <span className="text-amber-500 text-caption">
                        Outdated
                      </span>
                    ) : (
                      <div
                        className={
                          row.isFlowMetric && isStaleA
                            ? "text-amber-500"
                            : undefined
                        }
                      >
                        {row.format(valA)}
                      </div>
                    )}
                  </td>
                  <td className="text-right py-1.5 pl-2">
                    {row.isFlowMetric && isOutdatedB ? (
                      <span className="text-amber-500 text-caption">
                        Outdated
                      </span>
                    ) : (
                      <div
                        className={
                          row.isFlowMetric && isStaleB
                            ? "text-amber-500"
                            : undefined
                        }
                      >
                        {row.format(valB)}
                      </div>
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
                <div className="text-caption text-faint">
                  {formatCurrency(yearA.portfolioTotal + yearA.cash)} /{" "}
                  {formatCurrency(yearA.fiTarget)}
                </div>
              </td>
              <td className="text-right py-1.5 pl-2">
                <div>{formatPercent(yearB.fiProgress, 1)}</div>
                <div className="text-caption text-faint">
                  {formatCurrency(yearB.portfolioTotal + yearB.cash)} /{" "}
                  {formatCurrency(yearB.fiTarget)}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
