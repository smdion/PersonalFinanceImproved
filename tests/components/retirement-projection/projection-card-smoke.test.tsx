/**
 * Card-level smoke test before the split of retirement-projection/index.tsx
 * (RULES § Refactoring: smoke tests before any split; target-architecture
 * § 8.7: card-level smoke, each panel present). A dated temporary net: the
 * split that replaces the file replaces this test.
 *
 * The card mounts on mocked tRPC whose `projection.computeProjection`
 * answers with a real engine run of an invented household
 * (projection-household.ts). The simulation is left off, as a household
 * with simulation auto-load disabled sees it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProvider } from "@/lib/context/user-context";
import { calculateProjection } from "@/lib/pure/engine";
import { SK_RETIREMENT_MC_AUTOLOAD } from "@/lib/constants/settings-keys";
import { formatCurrency } from "@/lib/utils/format";
import { rowTotal } from "@/components/retirement-projection/parent-category-filter";
import { annAndBo, engineDataFor, people } from "../projection-household";
import { resetTrpcMock, setQuery } from "../trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../trpc-mock")).trpc,
}));
vi.mock("recharts", () => {
  const Box = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Nothing = () => null;
  return {
    ResponsiveContainer: Box,
    ComposedChart: Box,
    LineChart: Box,
    AreaChart: Box,
    BarChart: Box,
    Bar: Nothing,
    Area: Nothing,
    Line: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    CartesianGrid: Nothing,
    Tooltip: Nothing,
    Legend: Nothing,
    ReferenceLine: Nothing,
    ReferenceArea: Nothing,
    ReferenceDot: Nothing,
    Cell: Nothing,
    Label: Nothing,
  };
});

import { ProjectionCard } from "@/components/retirement-projection";

const engineData = engineDataFor(calculateProjection(annAndBo()));

beforeEach(() => {
  resetTrpcMock();
  localStorage.clear();
  setQuery("settings.appSettings.list", [
    { key: SK_RETIREMENT_MC_AUTOLOAD, value: false },
  ]);
  setQuery("projection.computeProjection", engineData);
});

const renderCard = () =>
  render(
    <UserProvider user={{ name: "Ann", role: "admin", permissions: [] }}>
      <TooltipProvider>
        <ProjectionCard people={people} withdrawalRate={0.04} />
      </TooltipProvider>
    </UserProvider>,
  );

const yearOf = (year: number) =>
  engineData.result.projectionByYear.find((y) => y.year === year)!;

describe("ProjectionCard smoke", () => {
  it("renders every panel from one engine result", async () => {
    renderCard();
    // The projection table, both phases.
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("cell", { name: "2026" })).toBeTruthy();
    expect(within(table).getAllByText("SAVE").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("DRAW").length).toBeGreaterThan(0);
    // Hero figures: the balance at retirement (2033) shows in the hero
    // and on the table's 2033 row.
    const atRetirement = formatCurrency(rowTotal(yearOf(2033)));
    expect(within(table).getByText(atRetirement)).toBeInTheDocument();
    expect(screen.getAllByText(atRetirement).length).toBeGreaterThan(1);
    // The simulation is off: the card offers to run it.
    expect(
      screen.getByRole("button", { name: /run simulation/i }),
    ).toBeInTheDocument();
    // Withdrawal routing (decumulation defaults) and the per-year changes
    // panel are mounted.
    expect(screen.getByRole("button", { name: /^configure$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /add a change/i })).toBeTruthy();
  });

  it("All years lists every projected year in the table", async () => {
    renderCard();
    const table = await screen.findByRole("table");
    // Collapsed by default: milestone years only.
    expect(within(table).queryByRole("cell", { name: "2027" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /all years/i }));
    for (const { year } of engineData.result.projectionByYear)
      expect(
        within(screen.getByRole("table")).getByRole("cell", {
          name: String(year),
        }),
      ).toBeTruthy();
  });
});
