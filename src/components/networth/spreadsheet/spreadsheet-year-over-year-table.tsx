"use client";

/** Dense year-over-year comparison table matching the spreadsheet layout.
 *  Row definitions are data-driven — performance categories are derived from data keys,
 *  not hardcoded arrays (per RULES.md §Data-Driven Architecture). */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { PERF_CATEGORY_HSA } from "@/lib/config/display-labels";
import { PERFORMANCE_STALE_DAYS } from "@/lib/constants";
import type { DetailedHistoryRow } from "./types";

/** How a row's comparison should be handled for current-year data. */
type FlowType =
  | "balance" // point-in-time value — no proration
  | "contribution" // scheduled flow — prorate in Projected mode
  | "market"; // market-driven flow (gains/losses/distributions) — never prorate

type RowConfig = {
  label: string;
  accessor: (row: DetailedHistoryRow) => number | null;
  flowType: FlowType;
};

/** Check if performance data is stale (>14 days since last update). */
function isPerformanceOutdated(row: DetailedHistoryRow): boolean {
  if (!row.perfLastUpdated) return true;
  const daysSince =
    (Date.now() - new Date(row.perfLastUpdated).getTime()) / 86_400_000;
  return daysSince > PERFORMANCE_STALE_DAYS;
}

function buildRowConfigs(
  categoryKeys: string[],
  parentCategoryKeys: string[],
  useMarketValue: boolean,
): RowConfig[] {
  const rows: RowConfig[] = [
    {
      label: "Gross",
      accessor: (r) => r.grossIncome,
      flowType: "balance",
    },
    {
      label: "Net Worth",
      accessor: (r) =>
        useMarketValue ? r.netWorthMarket : r.netWorthCostBasis,
      flowType: "balance",
    },
    {
      label: "House",
      accessor: (r) => (useMarketValue ? r.houseValue : r.houseValueCostBasis),
      flowType: "balance",
    },
  ];

  // Add performance category rows — derived from data keys, not hardcoded
  for (const category of categoryKeys) {
    rows.push({
      label: `${category} Value`,
      accessor: (r) => r.performanceByCategory[category]?.endingBalance ?? null,
      flowType: "balance",
    });
    rows.push({
      label: `${category} - Contributions`,
      accessor: (r) => {
        const cat = r.performanceByCategory[category];
        if (!cat) return null;
        return cat.contributions + cat.employerMatch;
      },
      flowType: "contribution",
    });
    rows.push({
      label: `${category} - Gains/Losses`,
      accessor: (r) => r.performanceByCategory[category]?.gainLoss ?? null,
      flowType: "market",
    });
    // Add distributions row for categories that have them (e.g., HSA)
    if (category === PERF_CATEGORY_HSA) {
      rows.push({
        label: `${category} - Distributions`,
        accessor: (r) =>
          r.performanceByCategory[category]?.distributions ?? null,
        flowType: "market",
      });
    }
  }

  rows.push({
    label: "Cash",
    accessor: (r) => r.cash,
    flowType: "balance",
  });

  // Parent category rollup rows — data-driven from parentCategory
  for (const parentCat of parentCategoryKeys) {
    rows.push({
      label: `${parentCat} Value`,
      accessor: (r) =>
        r.performanceByParentCategory[parentCat]?.endingBalance ?? null,
      flowType: "balance",
    });
    rows.push({
      label: `${parentCat} - Contributions`,
      accessor: (r) => {
        const cat = r.performanceByParentCategory[parentCat];
        if (!cat) return null;
        return cat.contributions + cat.employerMatch;
      },
      flowType: "contribution",
    });
    rows.push({
      label: `${parentCat} - Gains/Losses`,
      accessor: (r) =>
        r.performanceByParentCategory[parentCat]?.gainLoss ?? null,
      flowType: "market",
    });
  }

  // Portfolio total (all accounts combined)
  rows.push(
    {
      label: "Portfolio Value",
      accessor: (r) => r.portfolioTotal,
      flowType: "balance",
    },
    {
      label: "Portfolio - Contributions",
      accessor: (r) => r.perfContributions,
      flowType: "contribution",
    },
    {
      label: "Portfolio - Gains/Losses",
      accessor: (r) => r.perfGainLoss,
      flowType: "market",
    },
  );

  return rows;
}

type Props = {
  yearA: DetailedHistoryRow;
  yearB: DetailedHistoryRow;
  /** When true, prorate contribution comparisons for current year (Projected Year mode). */
  annualize: boolean;
  /** When true, use market value for house/net worth; when false, use cost basis. */
  useMarketValue: boolean;
};

export function SpreadsheetYearOverYearTable({
  yearA,
  yearB,
  annualize,
  useMarketValue,
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

  // Derive parent category keys — exclude "Portfolio" (shown as the total row)
  const parentCategoryKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const key of Object.keys(yearA.performanceByParentCategory))
      keys.add(key);
    for (const key of Object.keys(yearB.performanceByParentCategory))
      keys.add(key);
    keys.delete("Portfolio");
    return Array.from(keys).sort();
  }, [yearA, yearB]);

  const rowConfigs = useMemo(
    () => buildRowConfigs(categoryKeys, parentCategoryKeys, useMarketValue),
    [categoryKeys, parentCategoryKeys, useMarketValue],
  );

  const yearAOutdated = isPerformanceOutdated(yearA);
  const yearBOutdated = isPerformanceOutdated(yearB);
  const hasProrated = annualize && (yearA.isCurrent || yearB.isCurrent);

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
            {rowConfigs.map((config, index) => {
              const valueA = config.accessor(yearA);
              const valueB = config.accessor(yearB);

              const isFlow =
                config.flowType === "contribution" ||
                config.flowType === "market";

              // "Outdated" on value cells when performance data is stale (>14 days)
              const showOutdatedA = isFlow && yearA.isCurrent && yearAOutdated;
              const showOutdatedB = isFlow && yearB.isCurrent && yearBOutdated;

              // "In Progress" on change columns only when either value is outdated
              const showInProgress = showOutdatedA || showOutdatedB;

              // Compute comparison — only prorate contributions, never gains/losses
              let dollarChange: number | null = null;
              let percentChange: number | null = null;
              let isProrated = false;

              if (valueA !== null && valueB !== null) {
                if (
                  annualize &&
                  config.flowType === "contribution" &&
                  yearA.isCurrent &&
                  yearA.ytdRatio > 0 &&
                  yearA.ytdRatio < 1 &&
                  !yearB.isCurrent
                ) {
                  // Year A is current, Year B is finalized — prorate B down
                  const proratedB = valueB * yearA.ytdRatio;
                  dollarChange = valueA - proratedB;
                  percentChange =
                    proratedB !== 0 ? dollarChange / Math.abs(proratedB) : null;
                  isProrated = true;
                } else if (
                  annualize &&
                  config.flowType === "contribution" &&
                  yearB.isCurrent &&
                  yearB.ytdRatio > 0 &&
                  yearB.ytdRatio < 1 &&
                  !yearA.isCurrent
                ) {
                  // Year B is current, Year A is finalized — prorate A down
                  const proratedA = valueA * yearB.ytdRatio;
                  dollarChange = proratedA - valueB;
                  percentChange =
                    valueB !== 0 ? dollarChange / Math.abs(valueB) : null;
                  isProrated = true;
                } else {
                  // Both finalized, both current, market flows, or Actual YTD mode
                  dollarChange = valueA - valueB;
                  percentChange =
                    valueB !== 0 ? dollarChange / Math.abs(valueB) : null;
                }
              }

              return (
                <tr
                  key={config.label}
                  className={`border-b border-subtle ${index % 2 === 0 ? "bg-surface-sunken/50" : ""}`}
                >
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
                        {isProrated && "*"}
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
                        {isProrated && "*"}
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
        {hasProrated && (
          <p className="text-[10px] text-faint mt-2">
            * Prorated — comparison year scaled to match YTD period for
            contributions
          </p>
        )}
      </div>
    </Card>
  );
}
