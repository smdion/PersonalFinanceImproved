/**
 * Smoke test before the split of brokerage/brokerage-content.tsx (RULES §
 * Refactoring: smoke tests before any split; target-architecture § 8.7).
 * A dated temporary net: the split that replaces the file replaces this
 * test.
 *
 * The page mounts on mocked tRPC whose `projection.computeProjection`
 * answers with a real engine run of the invented household in
 * projection-household.ts (Bo's brokerage account), plus one brokerage
 * goal; the goal calculator runs for real on it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProvider } from "@/lib/context/user-context";
import { calculateProjection } from "@/lib/pure/engine";
import { calculateBrokerageGoals } from "@/lib/pure/savings/brokerage-goals";
import { formatCurrency } from "@/lib/utils/format";
import { annAndBo, engineDataFor } from "./projection-household";
import { mutationCalls, resetTrpcMock, setQuery } from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { BrokerageContent } from "@/app/(dashboard)/brokerage/brokerage-content";

const cabin = {
  id: 61,
  name: "Lake cabin down payment",
  targetAmount: 40000,
  targetYear: 2030,
  priority: 1,
};
const engineData = {
  ...engineDataFor(calculateProjection(annAndBo())),
  brokerageGoals: [cabin],
};

beforeEach(() => {
  resetTrpcMock();
  localStorage.clear();
  setQuery("projection.computeProjection", engineData);
  setQuery("retirement.projectionOverrides.get", []);
  setQuery("performance.performanceAccounts.list", [
    {
      id: 7,
      accountType: "brokerage",
      parentCategory: "Portfolio",
      accountLabel: "Bo Brokerage",
      displayName: null,
      institution: "Vanguard",
      ownerPersonId: 2,
      ownershipType: "individual",
      costBasis: "180000",
      isActive: true,
    },
  ]);
});

const renderPage = () =>
  render(
    <UserProvider user={{ name: "Bo", role: "admin", permissions: [] }}>
      <TooltipProvider>
        <BrokerageContent />
      </TooltipProvider>
    </UserProvider>,
  );

/** The Cost Basis card's row for Bo's account. */
const costBasisRow = () =>
  screen.getAllByText("Bo Brokerage")[0]!.parentElement!;

describe("BrokerageContent smoke", () => {
  it("renders the cost basis, funding, goal status and year-by-year panels", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: "Brokerage Projection" }),
    ).toBeInTheDocument();
    expect(within(costBasisRow()).getByRole("spinbutton")).toHaveValue(180000);
    // The goal's status, from the real goal calculator over the engine run.
    const status = calculateBrokerageGoals({
      asOfDate: new Date(),
      goals: [cabin],
      engineYears: engineData.result.projectionByYear,
    }).goals[0]!;
    const goalRow = screen.getAllByText(cabin.name)[0]!.closest("tr")!;
    expect(goalRow).toHaveTextContent(formatCurrency(status.targetAmount, 0));
    expect(goalRow).toHaveTextContent("2030");
    // Year-by-year table: a row per projected year.
    const tables = screen.getAllByRole("table");
    const yearly = tables.at(-1)!;
    expect(within(yearly).getAllByText("2030").length).toBeGreaterThan(0);
  });

  it("saving a cost basis sends that account's new figure", () => {
    renderPage();
    const row = costBasisRow();
    fireEvent.change(within(row).getByRole("spinbutton"), {
      target: { value: "185500" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(mutationCalls("performance.updateCostBasis")).toEqual([
      { performanceAccountId: 7, costBasis: "185500" },
    ]);
  });
});
