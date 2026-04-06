"use client";

/** Dense year-over-year comparison table matching the spreadsheet layout.
 *  Row definitions are data-driven — performance categories are derived from data keys,
 *  not hardcoded arrays (per RULES.md §Data-Driven Architecture). */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { PERFORMANCE_STALE_DAYS } from "@/lib/constants";
import type { DetailedHistoryRow } from "./types";

type RowConfig = {
  label: string;
  accessor: (row: DetailedHistoryRow) => number | null;
  /** Flow metrics (contributions, gains, distributions) show "In Progress" for current year. */
  isFlowMetric: boolean;
};

/** Check if performance data is stale (>14 days since last update). */
function isPerformanceOutdated(row: DetailedHistoryRow): boolean {
  if (!row.perfLastUpdated) return true;
  const daysSince =
    (Date.now() - new Date(row.perfLastUpdated).getTime()) / 86_400_000;
  return daysSince > PERFORMANCE_STALE_DAYS;
}

function buildRowConfigs(categoryKeys: string[]): RowConfig[] {
  const rows: RowConfig[] = [
    {
      label: "Gross",
      accessor: (r) => r.grossIncome,
      isFlowMetric: false,
    },
    {
      label: "Net Worth",
      accessor: (r) => r.netWorth,
      isFlowMetric: false,
    },
    {
      label: "House",
      accessor: (r) => r.houseValue,
      isFlowMetric: false,
    },
  ];

  // Add performance category rows — derived from data keys, not hardcoded
  for (const category of categoryKeys) {
    rows.push({
      label: `${category} Value`,
      accessor: (r) => r.performanceByCategory[category]?.endingBalance ?? null,
      isFlowMetric: false,
    });
    rows.push({
      label: `${category} - Contributions`,
      accessor: (r) => {
        const cat = r.performanceByCategory[category];
        if (!cat) return null;
        return cat.contributions + cat.employerMatch;
      },
      isFlowMetric: true,
    });
    rows.push({
      label: `${category} - Gains/Losses`,
      accessor: (r) => r.performanceByCategory[category]?.gainLoss ?? null,
      isFlowMetric: true,
    });
    // Add distributions row for categories that have them (e.g., HSA)
    if (category === "HSA") {
      rows.push({
        label: `${category} - Distributions`,
        accessor: (r) =>
          r.performanceByCategory[category]?.distributions ?? null,
        isFlowMetric: true,
      });
    }
  }

  rows.push(
    {
      label: "Cash",
      accessor: (r) => r.cash,
      isFlowMetric: false,
    },
    {
      label: "Portfolio Value",
      accessor: (r) => r.portfolioTotal,
      isFlowMetric: false,
    },
    {
      label: "Portfolio - Contributions",
      accessor: (r) => r.perfContributions,
      isFlowMetric: true,
    },
    {
      label: "Portfolio - Gains/Losses",
      accessor: (r) => r.perfGainLoss,
      isFlowMetric: true,
    },
  );

  return rows;
}

type Props = {
  yearA: DetailedHistoryRow;
  yearB: DetailedHistoryRow;
  /** When true, annualize current-year flow metrics (Projected Year mode). */
  annualize: boolean;
};

export function SpreadsheetYearOverYearTable({
  yearA,
  yearB,
  annualize,
}: Props) {
  // Derive category keys from both years' data (union of all categories present)
  const categoryKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const key of Object.keys(yearA.performanceByCategory)) keys.add(key);
    for (const key of Object.keys(yearB.performanceByCategory)) keys.add(key);
    // Remove "Portfolio" — shown separately as the total row
    keys.delete("Portfolio");
    // Sort for stable order: 401k/IRA first, then HSA, then Brokerage (alphabetical works)
    return Array.from(keys).sort();
  }, [yearA, yearB]);

  const rowConfigs = useMemo(
    () => buildRowConfigs(categoryKeys),
    [categoryKeys],
  );

  const yearAOutdated = isPerformanceOutdated(yearA);
  const yearBOutdated = isPerformanceOutdated(yearB);

  return (
    <Card title="Net Worth Year over Year" className="mb-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1.5 pr-2 text-muted font-medium" />
              <th className="text-right py-1.5 px-2 text-muted font-medium w-28">
                {yearA.year}
              </th>
              <th className="text-right py-1.5 px-2 text-muted font-medium w-28">
                {yearB.year}
              </th>
              <th className="text-right py-1.5 px-2 text-muted font-medium w-20">
                % Chg
              </th>
              <th className="text-right py-1.5 pl-2 text-muted font-medium w-24">
                $ Chg
              </th>
            </tr>
          </thead>
          <tbody>
            {rowConfigs.map((config) => {
              // Always show actual values (no annualization)
              const valueA = config.accessor(yearA);
              const valueB = config.accessor(yearB);

              // "Outdated" on value cells when performance data is stale (>14 days)
              const showOutdatedA =
                config.isFlowMetric && yearA.isCurrent && yearAOutdated;
              const showOutdatedB =
                config.isFlowMetric && yearB.isCurrent && yearBOutdated;

              // "In Progress" on change columns only when either value is outdated
              const showInProgress = showOutdatedA || showOutdatedB;

              // For flow metrics with a current year: prorate the comparison year
              // to the same time fraction so % Change is apples-to-apples.
              // In "Projected Year" mode, prorate the full-year value down.
              // In "Actual YTD" mode, show raw comparison (full year vs YTD).
              let dollarChange: number | null = null;
              let percentChange: number | null = null;

              if (valueA !== null && valueB !== null) {
                if (
                  annualize &&
                  config.isFlowMetric &&
                  yearA.isCurrent &&
                  yearA.ytdRatio > 0 &&
                  yearA.ytdRatio < 1 &&
                  !yearB.isCurrent
                ) {
                  // Year A is current, Year B is finalized — prorate B to match A's timeframe
                  const proratedB = valueB * yearA.ytdRatio;
                  dollarChange = valueA - proratedB;
                  percentChange =
                    proratedB !== 0 ? dollarChange / Math.abs(proratedB) : null;
                } else if (
                  annualize &&
                  config.isFlowMetric &&
                  yearB.isCurrent &&
                  yearB.ytdRatio > 0 &&
                  yearB.ytdRatio < 1 &&
                  !yearA.isCurrent
                ) {
                  // Year B is current, Year A is finalized — prorate A to match B's timeframe
                  const proratedA = valueA * yearB.ytdRatio;
                  dollarChange = proratedA - valueB;
                  percentChange =
                    valueB !== 0 ? dollarChange / Math.abs(valueB) : null;
                } else {
                  // Both finalized or both current or actual YTD mode — straight comparison
                  dollarChange = valueA - valueB;
                  percentChange =
                    valueB !== 0 ? dollarChange / Math.abs(valueB) : null;
                }
              }

              return (
                <tr key={config.label} className="border-b border-subtle">
                  <td className="py-1.5 pr-2 font-medium text-secondary">
                    {config.label}
                    {(yearA.isCurrent || yearB.isCurrent) && (
                      <span className="text-faint font-normal"> - YTD</span>
                    )}
                  </td>
                  <td className="text-right py-1.5 px-2">
                    {showOutdatedA ? (
                      <span className="text-amber-500 text-[10px]">
                        Outdated
                      </span>
                    ) : valueA !== null ? (
                      <span
                        className={valueA < 0 ? "text-red-600" : "text-primary"}
                      >
                        {formatCurrency(valueA)}
                      </span>
                    ) : (
                      <span className="text-faint">&mdash;</span>
                    )}
                  </td>
                  <td className="text-right py-1.5 px-2">
                    {showOutdatedB ? (
                      <span className="text-amber-500 text-[10px]">
                        Outdated
                      </span>
                    ) : valueB !== null ? (
                      <span
                        className={valueB < 0 ? "text-red-600" : "text-primary"}
                      >
                        {formatCurrency(valueB)}
                      </span>
                    ) : (
                      <span className="text-faint">&mdash;</span>
                    )}
                  </td>
                  <td className="text-right py-1.5 px-2">
                    {showInProgress ? (
                      <span className="text-blue-500 text-[10px]">
                        In Progress
                      </span>
                    ) : percentChange !== null ? (
                      <span
                        className={
                          percentChange >= 0 ? "text-green-600" : "text-red-600"
                        }
                      >
                        {formatPercent(percentChange, 1)}
                      </span>
                    ) : (
                      <span className="text-faint">&mdash;</span>
                    )}
                  </td>
                  <td className="text-right py-1.5 pl-2">
                    {showInProgress ? (
                      <span className="text-blue-500 text-[10px]">
                        In Progress
                      </span>
                    ) : dollarChange !== null ? (
                      <span
                        className={
                          dollarChange >= 0 ? "text-green-600" : "text-red-600"
                        }
                      >
                        {dollarChange >= 0 ? "+" : ""}
                        {formatCurrency(dollarChange)}
                      </span>
                    ) : (
                      <span className="text-faint">&mdash;</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
