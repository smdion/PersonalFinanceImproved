/* eslint-disable no-restricted-syntax -- as unknown as casts build the engine query payload and the card state without every unrelated field */
/**
 * Smoke test before the split of projection-table-accum-row.tsx and
 * projection-table-decum-row.tsx (RULES § Refactoring: smoke tests before
 * any split; target-architecture § 8.7). A dated temporary net: the split
 * that replaces these two files replaces this test.
 *
 * Each row renders from a real engine run of an invented household, through
 * the real derived-state hook: a saving year, a gap year (one spouse retired,
 * the other still paid, accounts paying in), a retirement year, and the
 * penalty-locked year (the only reachable account is empty and the rest is
 * locked until 59½, so part of the need goes unmet).
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { calculateProjection } from "@/lib/calculators/engine";
import type {
  EngineAccumulationYear,
  EngineDecumulationYear,
  ProjectionResult,
} from "@/lib/calculators/types";
import { formatCurrency } from "@/lib/utils/format";
import { useProjectionDerived } from "@/components/cards/projection/use-projection-derived";
import type { ProjectionFormState } from "@/components/cards/projection/use-projection-form-state";
import type { ProjectionQueries } from "@/components/cards/projection/use-projection-queries";
import type { ProjectionState } from "@/components/cards/projection/projection-table-types";
import { AccumulationRow } from "@/components/cards/projection/projection-table-accum-row";
import { DecumulationRow } from "@/components/cards/projection/projection-table-decum-row";
import type { RenderMcCellOptions } from "@/components/cards/projection/projection-table-mc-cell";
import { annAndBo, engineDataFor, people } from "./projection-household";

/** The card's state for one engine result: the real derived-state hook,
 *  plus the view settings the card's form hook would supply. */
function stateFor(result: ProjectionResult): ProjectionState {
  const engineData = engineDataFor(result);
  const queries = {
    engineQuery: { data: engineData, isLoading: false, isFetching: false },
    contribProfilesQuery: { data: undefined },
    salaryProfilesQuery: { data: undefined },
  } as unknown as ProjectionQueries;
  const form = {
    accumOverrides: [],
    decumOverrides: [],
    dollarMode: "nominal",
    showAllYears: true,
    personFilter: "all",
    isPersonFiltered: false,
    scenarioView: "baseline",
  } as unknown as ProjectionFormState;
  const { result: derived } = renderHook(() =>
    useProjectionDerived(form, queries, { withdrawalRate: 0.04, people }),
  );
  return {
    ...form,
    ...derived.current,
    balanceView: "taxType",
    contribView: "account",
    diagMode: false,
    withdrawalRoutingMode: "waterfall",
    bracketOptimizerResult: null,
  } as unknown as ProjectionState;
}

const mcCellOpts = (state: ProjectionState): RenderMcCellOptions => ({
  mcBandsByYear: null,
  mcDetByYear: null,
  deflate: state.deflate,
  isPersonFiltered: false,
  diagMode: false,
  renderTooltip: state.renderTooltip,
});

let projection: ProjectionResult;
let state: ProjectionState;

function yearOf<P extends "accumulation" | "decumulation">(
  year: number,
  phase: P,
) {
  const yr = projection.projectionByYear.find((y) => y.year === year)!;
  expect(yr.phase).toBe(phase);
  return yr as P extends "accumulation"
    ? EngineAccumulationYear
    : EngineDecumulationYear;
}

function renderAccum(year: number) {
  const yr = yearOf(year, "accumulation");
  render(
    <TooltipProvider>
      <table>
        <tbody>
          <AccumulationRow
            yr={yr}
            state={state}
            isPhaseTransition={false}
            hasOverride={false}
            people={people}
            mcCellOpts={mcCellOpts(state)}
          />
        </tbody>
      </table>
    </TooltipProvider>,
  );
  return { yr, row: screen.getByRole("row") };
}

function renderDecum(year: number) {
  const yr = yearOf(year, "decumulation");
  render(
    <TooltipProvider>
      <table>
        <tbody>
          <DecumulationRow
            yr={yr}
            state={state}
            isPhaseTransition={false}
            hasOverride={false}
            people={people}
            mcCellOpts={mcCellOpts(state)}
          />
        </tbody>
      </table>
    </TooltipProvider>,
  );
  return { yr, row: screen.getByRole("row") };
}

/** Opens a cell's tooltip the way a keyboard user does, returns its text. */
function tooltipOf(cell: HTMLElement): string {
  fireEvent.focus(cell);
  return screen
    .getAllByRole("tooltip")
    .map((t) => t.textContent)
    .join(" ");
}

beforeAll(() => {
  projection = calculateProjection(annAndBo());
  state = stateFor(projection);
});

describe("AccumulationRow smoke", () => {
  it("a saving year: the year, SAVE, the household salary, no draw", () => {
    const { yr, row } = renderAccum(2027);
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("2027");
    expect(cells[1]).toHaveTextContent("SAVE");
    expect(row).not.toHaveTextContent("DRAW");
    expect(cells[2]).toHaveTextContent(formatCurrency(yr.projectedSalary));
    // The year cell's tooltip names each person's age that year.
    expect(tooltipOf(cells[0]!)).toContain("Ann: 51");
  });

  it("a gap year: Bo's pay only, and the accounts pay in (SAVE + DRAW)", () => {
    const { yr, row } = renderAccum(2030);
    expect(yr.gapDraw?.withdrawal).toBeGreaterThan(0);
    const cells = within(row).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("SAVE");
    expect(cells[1]).toHaveTextContent("DRAW");
    expect(cells[2]).toHaveTextContent(formatCurrency(yr.projectedSalary));
    expect(yr.projectedSalary).toBeLessThan(90000);
  });

  it("a gap year that stops saving reads HOLD", () => {
    projection = calculateProjection(annAndBo({ gapYearStopSaving: true }));
    state = stateFor(projection);
    try {
      const { yr, row } = renderAccum(2030);
      expect(yr.savingStopped).toBe(true);
      expect(within(row).getAllByRole("cell")[1]).toHaveTextContent("HOLD");
    } finally {
      projection = calculateProjection(annAndBo());
      state = stateFor(projection);
    }
  });
});

describe("DecumulationRow smoke", () => {
  it("a retirement year: DRAW, no salary, the withdrawal and the balance", () => {
    const { yr, row } = renderDecum(2033);
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("2033");
    expect(cells[1]).toHaveTextContent("DRAW");
    expect(cells[2]).toHaveTextContent("---");
    expect(row).toHaveTextContent(`-${formatCurrency(yr.totalWithdrawal)}`);
    expect(yr.totalWithdrawal).toBeGreaterThan(0);
  });

  it("the penalty-locked year: the unmet need excludes the locked money", () => {
    const { yr, row } = renderDecum(2035);
    expect(yr.penaltyAvoidedShortfall).toBeGreaterThan(0);
    // The total-withdrawal cell: the last one showing the year's draw
    // (the per-account cells before it can show the same amount).
    const withdrawalCell = within(row)
      .getAllByRole("cell")
      .filter((c) =>
        c.textContent?.includes(`-${formatCurrency(yr.totalWithdrawal)}`),
      )
      .at(-1)!;
    const tip = tooltipOf(withdrawalCell);
    expect(tip).toMatch(/penalty/i);
    expect(tip).toContain(formatCurrency(yr.penaltyAvoidedShortfall!));
  });

  it("the year Ann turns 59½: her 401k is drawn and marked eligible", () => {
    const { yr, row } = renderDecum(2036);
    const ann401k = yr.individualAccountBalances!.find(
      (ia) => ia.name === "Ann 401k",
    )!;
    expect(ann401k.withdrawal).toBeGreaterThan(0);
    expect(ann401k.eligibilityLocked).toBe(false);
    expect(row).toHaveTextContent(`-${formatCurrency(yr.totalWithdrawal)}`);
  });
});
