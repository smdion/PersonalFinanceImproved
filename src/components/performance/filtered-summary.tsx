"use client";

import React from "react";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { DEFAULT_INFLATION_RATE, DEFAULT_RETURN_RATE } from "@/lib/constants";
import type { ChainedReturn } from "@/lib/pure/performance";

/** Long-run nominal S&P 500 average (~10%, per Ibbotson/SBBI data since
 *  1926) — the "beating the market" reference point. Not a codebase
 *  constant like DEFAULT_RETURN_RATE/DEFAULT_INFLATION_RATE since it's
 *  purely informational here, not used in any calculation. */
const MARKET_AVERAGE_NOMINAL_RETURN = 0.1;

/**
 * CAGR/cumulative headline for a multi-year filtered account view. Only
 * rendered by the caller when the selected range spans >1 year — a
 * single-year/YTD selection uses the existing per-row return display
 * instead (see performance-table.tsx), no chaining involved.
 */
export function FilteredSummary({
  chained,
  totalYears,
  endingBalance,
  totalGainLoss,
}: {
  chained: ChainedReturn;
  /** Total years in the selected range, for the "N of M years" footnote. */
  totalYears: number;
  endingBalance: number;
  totalGainLoss: number;
}) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card
        title={
          <>
            Annualized Return
            <HelpTip
              lines={[
                "CAGR — the steady yearly pace that would produce the same total growth over the selected years. Directly comparable across different-length windows.",
                "This is a nominal figure — inflation is not subtracted out. Subtract your period's inflation rate to estimate real (purchasing-power) growth.",
                "Rough reference points (varies by asset mix and time horizon):",
                `Bad: below ${formatPercent(DEFAULT_INFLATION_RATE, 0)} — losing ground to inflation`,
                `Better: ${formatPercent(DEFAULT_INFLATION_RATE, 0)}–${formatPercent(DEFAULT_RETURN_RATE, 0)} — ahead of inflation, below this app's ${formatPercent(DEFAULT_RETURN_RATE, 0)} (nominal) retirement-planning default`,
                `Good: around ${formatPercent(DEFAULT_RETURN_RATE, 0)} — matches this app's own default planning assumption (a deliberately conservative nominal estimate, not tied to a specific historical dataset)`,
                `Best: ${formatPercent(MARKET_AVERAGE_NOMINAL_RETURN, 0)}+ — at/above the long-run nominal S&P 500 average (~10%, Ibbotson/SBBI data since 1926), rarely sustained for long stretches`,
              ]}
              maxWidth={320}
            />
          </>
        }
      >
        <Metric
          value={
            chained.annualizedReturn !== null
              ? formatPercent(chained.annualizedReturn, 1)
              : "—"
          }
          label="Derived from chained annual Modified-Dietz returns"
        />
      </Card>
      <Card
        title={
          <>
            Cumulative Return
            <HelpTip text="Total percentage growth across the selected years, chain-linked from each year's return." />
          </>
        }
      >
        <Metric
          value={
            chained.cumulativeReturn !== null
              ? formatPercent(chained.cumulativeReturn, 1)
              : "—"
          }
          trend={{
            value: formatCurrency(totalGainLoss),
            isPositive: totalGainLoss >= 0,
          }}
        />
      </Card>
      <Card title="Ending Balance">
        <Metric
          value={formatCurrency(endingBalance)}
          label={
            chained.yearsIncluded < totalYears
              ? `Based on ${chained.yearsIncluded} of ${totalYears} selected years — some excluded (no capital at risk)`
              : `Across ${chained.yearsIncluded} year${chained.yearsIncluded !== 1 ? "s" : ""}`
          }
        />
      </Card>
    </div>
  );
}
