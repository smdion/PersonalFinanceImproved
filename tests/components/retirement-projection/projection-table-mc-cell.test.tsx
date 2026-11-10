/* eslint-disable no-restricted-syntax -- as unknown as casts build a band and a year row without every unrelated field */
/**
 * The Retirement table's Simulation cell shows the band it is given: the
 * bands arrive already in the view's dollars (`simulationDollars`: today's
 * are deflated per trial), so the cell never deflates them again. The
 * screens review's run: the headline's median $663,748 showed as $367,501
 * in the table's Today's $ view (deflated a second time at the plan's
 * rate). Invented figures below; the deflator is that run's ratio.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/utils/format";
import {
  renderSimulationCell,
  type RenderSimulationCellOptions,
} from "@/components/retirement-projection/table/projection-table-mc-cell";
import type { EngineYearProjection } from "@/lib/pure/engine/types";
import type { MonteCarloPercentileBand } from "@/lib/pure/simulation/monte-carlo.types";

const YEAR = 2052;
const MEDIAN_TODAY = 663_748;
/** The plan's flat deflator for YEAR in the review's run. */
const FACTOR = 663_748 / 367_501;

const band = {
  year: YEAR,
  p5: 200_000,
  p10: 260_000,
  p25: 450_000,
  p50: MEDIAN_TODAY,
  p75: 900_000,
  p90: 1_200_000,
  p95: 1_400_000,
} as unknown as MonteCarloPercentileBand;

function cell(): ReactNode {
  const opts: RenderSimulationCellOptions = {
    simulationBandsByYear: new Map([[YEAR, band]]),
    simulationDetByYear: null,
    deflate: (amount) => amount / FACTOR,
    isPersonFiltered: false,
    diagMode: false,
    renderTooltip: ({ items }) => (
      <ul>
        {items.map((i) => (
          <li key={i.label}>
            {i.label}: {formatCurrency(i.amount)}
          </li>
        ))}
      </ul>
    ),
  };
  return renderSimulationCell(
    { year: YEAR } as unknown as EngineYearProjection,
    MEDIAN_TODAY,
    opts,
  );
}

describe("the Retirement table's Simulation cell", () => {
  it("sim/UI1 [SIM-13] the Today's $ cell shows the band's median as given: $663,748, not $367,501", () => {
    render(
      <TooltipProvider>
        <table>
          <tbody>
            <tr>{cell()}</tr>
          </tbody>
        </table>
      </TooltipProvider>,
    );
    const td = screen.getByRole("cell");
    expect(td.textContent).toContain(formatCurrency(MEDIAN_TODAY));
    expect(td.textContent).not.toContain(formatCurrency(367_501));
  });
});
