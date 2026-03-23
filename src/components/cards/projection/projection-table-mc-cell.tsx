/** Renders a single Monte Carlo median cell with p5-p95 percentile tooltip and delta-vs-deterministic indicator. */
import React from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type {
  EngineYearProjection,
  EngineAccumulationYear,
  EngineDecumulationYear,
  MonteCarloPercentileBand,
} from "@/lib/calculators/types";

export type RenderMcCellOptions = {
  mcBandsByYear: Map<number, MonteCarloPercentileBand> | null;
  mcDetByYear: Map<number, EngineYearProjection> | null;
  deflate: (amount: number, year: number) => number;
  isPersonFiltered: boolean;
  parentCategoryFilter?: string;
  diagMode: boolean;
  renderTooltip: (opts: {
    kind: "money";
    header: string;
    items: { label: string; amount: number }[];
    overrideNote?: string;
  }) => React.ReactNode;
};

export function renderMcCell(
  yr: EngineYearProjection,
  detBal: number,
  opts: RenderMcCellOptions,
) {
  const {
    mcBandsByYear,
    mcDetByYear,
    deflate,
    isPersonFiltered,
    parentCategoryFilter,
    diagMode,
    renderTooltip,
  } = opts;
  if (!mcBandsByYear) return null;
  const band = mcBandsByYear.get(yr.year);
  if (!band)
    return (
      <td className="text-right py-1.5 px-2 text-faint">
        ---
      </td>
    );
  const mcP50 = deflate(band.p50, yr.year);
  const showDelta =
    !isPersonFiltered && !parentCategoryFilter;
  const delta = mcP50 - detBal;
  const deltaColor =
    delta >= 0 ? "text-green-600" : "text-red-500";
  // Proof: show MC's own deterministic year data to verify overrides are applied (diag mode only)
  const mcDetYr = diagMode
    ? mcDetByYear?.get(yr.year)
    : undefined;
  let proofNote: string | undefined;
  if (mcDetYr) {
    const parts: string[] = [];
    parts.push(
      `MC det. bal: ${formatCurrency(deflate(mcDetYr.endBalance, yr.year))}`,
    );
    parts.push(`Standalone: ${formatCurrency(detBal)}`);
    parts.push(
      `Expenses: ${formatCurrency(deflate(mcDetYr.projectedExpenses, yr.year))}/yr`,
    );
    if (mcDetYr.phase === "accumulation") {
      const accYr = mcDetYr as EngineAccumulationYear;
      parts.push(
        `Salary: ${formatCurrency(deflate(accYr.projectedSalary, yr.year))}`,
      );
      parts.push(
        `Contribs: ${formatCurrency(deflate(accYr.totalEmployee + accYr.totalEmployer, yr.year))}`,
      );
    } else {
      const decYr = mcDetYr as EngineDecumulationYear;
      parts.push(
        `Withdrawals: ${formatCurrency(deflate(decYr.totalWithdrawal, yr.year))}`,
      );
      parts.push(
        `Tax rate: ${formatPercent(decYr.effectiveTaxRate, 1)}`,
      );
    }
    proofNote = `MC Engine: ${parts.join(" ·")}`;
  }
  return (
    <Tooltip
      content={renderTooltip({
        kind: "money",
        header: "MC Percentiles",
        items: [
          {
            label: "95th",
            amount: deflate(band.p95, yr.year),
          },
          {
            label: "75th",
            amount: deflate(band.p75, yr.year),
          },
          { label: "Median", amount: mcP50 },
          {
            label: "25th",
            amount: deflate(band.p25, yr.year),
          },
          {
            label: "5th",
            amount: deflate(band.p5, yr.year),
          },
        ],
        ...(isPersonFiltered || proofNote
          ? {
              overrideNote: [
                isPersonFiltered
                  ? "MC values are household aggregate"
                  : "",
                proofNote ?? "",
              ]
                .filter(Boolean)
                .join("\n"),
            }
          : {}),
      })}
      side="top"
    >
      <td className="text-right py-1.5 px-2 text-purple-700 tabular-nums border-l border-subtle">
        {formatCurrency(Math.max(0, mcP50))}
        {showDelta && Math.abs(delta) > 1 && (
          <div className={`text-[9px] ${deltaColor}`}>
            {delta >= 0 ? "+" : ""}
            {formatCurrency(delta)}
          </div>
        )}
      </td>
    </Tooltip>
  );
}
