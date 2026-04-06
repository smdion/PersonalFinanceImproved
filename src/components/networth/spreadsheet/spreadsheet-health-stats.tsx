"use client";

/** Financial Health Stats table — compact two-column comparison of wealth metrics. */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import {
  WEALTH_FORMULA_AGE_CUTOFF,
  WEALTH_FORMULA_BASE_DENOMINATOR,
  PERFORMANCE_STALE_DAYS,
} from "@/lib/constants";
import {
  projectFIYear,
  formatFIProjection,
} from "@/lib/calculators/fi-projection";
import type { DetailedHistoryRow } from "./types";

type Props = {
  yearA: DetailedHistoryRow;
  yearB: DetailedHistoryRow;
  /** All history rows for salary averaging. */
  allYears: DetailedHistoryRow[];
  /** Whether to use 3-year salary average for wealth metrics. */
  useSalaryAverage: boolean;
  /** All people's birth years for average age computation (spreadsheet uses avg of all). */
  birthYears: number[];
  /** Whether to use market value (true) or cost basis (false) for net worth in formulas. */
  useMarketValue: boolean;
  /** Annual expenses for FI calculation. */
  annualExpenses: number;
  /** Withdrawal rate for FI target (e.g. 0.04). */
  withdrawalRate: number;
};

/** Get effective income for a year: combinedAgi (falls back to grossIncome for current year). */
function getEffectiveIncome(row: DetailedHistoryRow): number {
  return row.combinedAgi > 0 ? row.combinedAgi : row.grossIncome;
}

/** Compute the effective salary for a given year, optionally averaging the 3 most recent years.
 *  Uses combinedAgi (matching spreadsheet) with grossIncome fallback for current year. */
function getEffectiveSalary(
  row: DetailedHistoryRow,
  allYears: DetailedHistoryRow[],
  useSalaryAverage: boolean,
): number {
  const income = getEffectiveIncome(row);
  if (!useSalaryAverage) return income;
  const recent = allYears
    .filter((h) => getEffectiveIncome(h) > 0 && h.year <= row.year)
    .sort((a, b) => b.year - a.year)
    .slice(0, 3);
  if (recent.length === 0) return income;
  return recent.reduce((s, h) => s + getEffectiveIncome(h), 0) / recent.length;
}

/** Compute cumulative lifetime earnings (sum of combinedAgi) up to and including the given year. */
function computeLifetimeEarnings(
  row: DetailedHistoryRow,
  allYears: DetailedHistoryRow[],
): number {
  return allYears
    .filter((h) => h.year <= row.year)
    .reduce((s, h) => s + getEffectiveIncome(h), 0);
}

function computeMetrics(
  row: DetailedHistoryRow,
  birthYears: number[],
  allYears: DetailedHistoryRow[],
  annualExpenses: number,
  withdrawalRate: number,
  effectiveSalary: number,
  useMarketValue: boolean,
) {
  // Average age across all people (matches spreadsheet behavior)
  const avgAge =
    birthYears.length > 0
      ? birthYears.reduce((s, by) => s + (row.year - by), 0) / birthYears.length
      : 0;

  // Net worth respects market/cost basis toggle
  const netWorth = useMarketValue ? row.netWorth : row.netWorthCostBasis;

  // Wealth Score: net worth as % of lifetime earnings (savings efficiency)
  const lifetimeEarnings = computeLifetimeEarnings(row, allYears);
  const wealthScore = Number(safeDivide(netWorth, lifetimeEarnings) ?? 0);

  // AAW Score: Money Guy formula — (Age × Income) / (10 + yearsUntil40)
  // Score ≥ 2.0 = PAW, 1.0 = AAW, ≤ 0.5 = UAW (×2 is the threshold, not in the formula)
  const yearsUntil40 = Math.max(0, WEALTH_FORMULA_AGE_CUTOFF - avgAge);
  const expectedNetWorth =
    (avgAge * effectiveSalary) /
    (WEALTH_FORMULA_BASE_DENOMINATOR + yearsUntil40);
  const aawScore = Number(safeDivide(netWorth, expectedNetWorth) ?? 0);

  // FI Progress
  const fiTarget = Number(safeDivide(annualExpenses, withdrawalRate) ?? 0);
  const fiProgress = Number(
    safeDivide(row.portfolioTotal + row.cash, fiTarget) ?? 0,
  );

  // Contribution rates (use grossIncome as denominator — rate of gross saved)
  const retirementCategory = Object.keys(row.performanceByCategory).find(
    (k) => k === "401k/IRA",
  );
  const brokerageCategory = Object.keys(row.performanceByCategory).find(
    (k) => k === "Brokerage",
  );
  const retirementContributions = retirementCategory
    ? (row.performanceByCategory[retirementCategory]?.contributions ?? 0) +
      (row.performanceByCategory[retirementCategory]?.employerMatch ?? 0)
    : 0;
  const brokerageContributions = brokerageCategory
    ? (row.performanceByCategory[brokerageCategory]?.contributions ?? 0)
    : 0;
  const totalContributions = row.perfContributions ?? 0;

  const retirementContribRate = Number(
    safeDivide(retirementContributions, row.grossIncome) ?? 0,
  );
  const brokerageContribRate = Number(
    safeDivide(brokerageContributions, row.grossIncome) ?? 0,
  );
  const portfolioContribRate = Number(
    safeDivide(totalContributions, row.grossIncome) ?? 0,
  );

  return {
    wealthScore,
    aawScore,
    fiProgress,
    retirementContribRate,
    brokerageContribRate,
    portfolioContribRate,
  };
}

type RowDef = {
  label: string;
  format: (value: number) => string;
  key: string;
  isFlowMetric: boolean;
};

const STAT_ROWS: RowDef[] = [
  {
    label: "Wealth Score",
    format: (v) => `${(v * 100).toFixed(0)}%`,
    key: "wealthScore",
    isFlowMetric: false,
  },
  {
    label: "AAW Score",
    format: (v) => v.toFixed(1),
    key: "aawScore",
    isFlowMetric: false,
  },
  {
    label: "Brokerage/ESPP Contribution Rate",
    format: (v) => formatPercent(v, 1),
    key: "brokerageContribRate",
    isFlowMetric: true,
  },
  {
    label: "Retirement Contribution Rate",
    format: (v) => formatPercent(v, 1),
    key: "retirementContribRate",
    isFlowMetric: true,
  },
  {
    label: "Portfolio Contribution Rate",
    format: (v) => formatPercent(v, 1),
    key: "portfolioContribRate",
    isFlowMetric: true,
  },
];

export function SpreadsheetHealthStats({
  yearA,
  yearB,
  allYears,
  useSalaryAverage,
  birthYears,
  useMarketValue,
  annualExpenses,
  withdrawalRate,
}: Props) {
  const salaryA = useMemo(
    () => getEffectiveSalary(yearA, allYears, useSalaryAverage),
    [yearA, allYears, useSalaryAverage],
  );
  const salaryB = useMemo(
    () => getEffectiveSalary(yearB, allYears, useSalaryAverage),
    [yearB, allYears, useSalaryAverage],
  );
  const metricsA = useMemo(
    () =>
      computeMetrics(
        yearA,
        birthYears,
        allYears,
        annualExpenses,
        withdrawalRate,
        salaryA,
        useMarketValue,
      ),
    [
      yearA,
      birthYears,
      allYears,
      annualExpenses,
      withdrawalRate,
      salaryA,
      useMarketValue,
    ],
  );
  const metricsB = useMemo(
    () =>
      computeMetrics(
        yearB,
        birthYears,
        allYears,
        annualExpenses,
        withdrawalRate,
        salaryB,
        useMarketValue,
      ),
    [
      yearB,
      birthYears,
      allYears,
      annualExpenses,
      withdrawalRate,
      salaryB,
      useMarketValue,
    ],
  );

  const fiProjection = useMemo(
    () =>
      projectFIYear(
        metricsA.fiProgress,
        metricsB.fiProgress,
        yearA.year,
        yearB.year,
      ),
    [metricsA.fiProgress, metricsB.fiProgress, yearA.year, yearB.year],
  );

  const hasCurrentYear = yearA.isCurrent || yearB.isCurrent;

  // Compute staleness cutoff date once (stable across renders)
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
              const valA = metricsA[row.key as keyof typeof metricsA] as number;
              const valB = metricsB[row.key as keyof typeof metricsB] as number;
              return (
                <tr key={row.key} className="border-b border-subtle">
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
                {formatPercent(metricsA.fiProgress, 1)}
              </td>
              <td className="text-right py-1.5 pl-2">
                {formatPercent(metricsB.fiProgress, 1)}
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
