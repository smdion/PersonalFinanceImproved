"use client";

/**
 * Performance table → the same year's money in an index instead (same
 * opening balance, same money in and out, spread across the year), with
 * the difference from your own return in points. Computed the way the
 * Return column is, so the two compare directly.
 */
import { formatPercent } from "@/lib/utils/format";
import { indexYearReturn } from "@/lib/pure/benchmark-yearly";
import type { BenchmarkColumn } from "./types";

export function BenchmarkCell({
  benchmark,
  row,
  dense = false,
}: {
  benchmark: BenchmarkColumn;
  row: {
    year: number;
    beginningBalance: number;
    totalContributions: number;
    rollovers: number;
    distributions: number;
    fees: number;
    yearlyGainLoss: number;
    endingBalance: number;
    annualReturnPct: number | null;
  };
  /** Account rows use the smaller padding. */
  dense?: boolean;
}) {
  const index = indexYearReturn(
    {
      year: row.year,
      begin: row.beginningBalance,
      contributions: row.totalContributions + row.rollovers,
      outflows: row.distributions + row.fees,
      gain: row.yearlyGainLoss,
      end: row.endingBalance,
    },
    benchmark.prices,
  );
  const pad = dense ? "py-2" : "py-3";
  if (!index || index.returnPct === null)
    return (
      <td
        className={`text-faint px-4 ${pad} text-right`}
        title="No index prices for this year"
      >
        —
      </td>
    );
  const diff =
    row.annualReturnPct === null ? null : row.annualReturnPct - index.returnPct;
  return (
    <td
      className={`text-muted px-4 ${pad} text-right whitespace-nowrap`}
      title={`The same money in the ${benchmark.label}${index.months < 12 ? ` (first ${index.months} months priced)` : ""}: ${formatPercent(index.returnPct, 1)}${diff === null ? "" : `. You: ${diff >= 0 ? "ahead" : "behind"} by ${Math.abs(diff * 100).toFixed(1)} points`}.`}
    >
      {formatPercent(index.returnPct, 1)}
      {index.months < 12 && (
        <span className="text-faint ml-0.5 text-xs">{index.months}mo</span>
      )}
      {diff !== null && (
        <span
          className={`ml-1.5 text-xs ${diff >= 0 ? "text-green-600" : "text-red-600"}`}
        >
          {diff >= 0 ? "+" : "−"}
          {Math.abs(diff * 100).toFixed(1)}
        </span>
      )}
    </td>
  );
}
