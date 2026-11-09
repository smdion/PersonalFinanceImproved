/** Renders a single Monte Carlo median cell with p5-p95 percentile tooltip and delta-vs-deterministic indicator. */
import { rowTotal } from "./parent-category-filter";
import React from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type {
  EngineYearProjection,
  EngineAccumulationYear,
  EngineDecumulationYear,
} from "@/lib/pure/engine/types";
import type { MonteCarloPercentileBand } from "@/lib/pure/simulation/monte-carlo.types";

export type RenderSimulationCellOptions = {
  simulationBandsByYear: Map<number, MonteCarloPercentileBand> | null;
  simulationDetByYear: Map<number, EngineYearProjection> | null;
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

export function renderSimulationCell(
  yearRow: EngineYearProjection,
  detBalance: number,
  opts: RenderSimulationCellOptions,
) {
  const {
    simulationBandsByYear,
    simulationDetByYear,
    deflate,
    isPersonFiltered,
    parentCategoryFilter,
    diagMode,
    renderTooltip,
  } = opts;
  if (!simulationBandsByYear) return null;
  const band = simulationBandsByYear.get(yearRow.year);
  if (!band) return <td className="text-faint px-2 py-1.5 text-right">---</td>;
  const simulationP50 = deflate(band.p50, yearRow.year);
  const showDelta = !isPersonFiltered && !parentCategoryFilter;
  const delta = simulationP50 - detBalance;
  const deltaColor = delta >= 0 ? "text-green-600" : "text-red-500";
  // Proof: show MC's own deterministic year data to verify overrides are applied (diag mode only)
  const simulationDeterministicYear = diagMode
    ? simulationDetByYear?.get(yearRow.year)
    : undefined;
  let proofNote: string | undefined;
  if (simulationDeterministicYear) {
    const parts: string[] = [];
    parts.push(
      `Simulation det. bal: ${formatCurrency(deflate(rowTotal(simulationDeterministicYear), yearRow.year))}`,
    );
    parts.push(`Standalone: ${formatCurrency(detBalance)}`);
    parts.push(
      simulationDeterministicYear.phase === "decumulation"
        ? `Spending: ${formatCurrency(deflate(simulationDeterministicYear.spending, yearRow.year))}/yr`
        : `Expenses: ${formatCurrency(deflate(simulationDeterministicYear.projectedExpenses, yearRow.year))}/yr`,
    );
    if (simulationDeterministicYear.phase === "accumulation") {
      const accumulationYear =
        simulationDeterministicYear as EngineAccumulationYear;
      parts.push(
        `Salary: ${formatCurrency(deflate(accumulationYear.projectedSalary, yearRow.year))}`,
      );
      parts.push(
        `Contribs: ${formatCurrency(deflate(accumulationYear.totalEmployee + accumulationYear.totalEmployer, yearRow.year))}`,
      );
    } else {
      const decumulationYear =
        simulationDeterministicYear as EngineDecumulationYear;
      parts.push(
        `Withdrawals: ${formatCurrency(deflate(decumulationYear.totalWithdrawal, yearRow.year))}`,
      );
      parts.push(
        `Tax rate: ${formatPercent(decumulationYear.effectiveTaxRate, 1)}`,
      );
      if (decumulationYear.ssTaxCost > 0)
        parts.push(
          `Tax on Social Security: ${formatCurrency(deflate(decumulationYear.ssTaxCost, yearRow.year))}`,
        );
    }
    proofNote = `Simulation engine: ${parts.join(" ·")}`;
  }
  return (
    <Tooltip
      content={renderTooltip({
        kind: "money",
        header: "Simulation Range",
        items: [
          {
            label: "95th",
            amount: deflate(band.p95, yearRow.year),
          },
          {
            label: "75th",
            amount: deflate(band.p75, yearRow.year),
          },
          { label: "Median", amount: simulationP50 },
          {
            label: "25th",
            amount: deflate(band.p25, yearRow.year),
          },
          {
            label: "5th",
            amount: deflate(band.p5, yearRow.year),
          },
        ],
        ...(isPersonFiltered || proofNote
          ? {
              overrideNote: [
                isPersonFiltered
                  ? "Simulation values are household aggregate"
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
      <td className="border-subtle border-l px-2 py-1.5 text-right text-purple-700 tabular-nums">
        {formatCurrency(Math.max(0, simulationP50))}
        {showDelta && Math.abs(delta) > 1 && (
          <div className={`text-micro ${deltaColor}`}>
            {delta >= 0 ? "+" : ""}
            {formatCurrency(delta)}
          </div>
        )}
      </td>
    </Tooltip>
  );
}
