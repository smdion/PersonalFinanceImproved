/**
 * Smoke test for the Expenses page content (v0.10.4 commit 5a, before 8a
 * gives its group rows a keyboard path): with a budget API's categories
 * cached, the summary and the category table render, and a group row's
 * click expands its categories. The page writes nothing, so the row toggle
 * stands in for a mutation. No baseline household has a budget API, so the
 * data is invented here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { resetTrpcMock, setQuery } from "./trpc-mock";
import { ScenarioProvider } from "@/lib/context/scenario-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ExpensesContent } from "@/app/(dashboard)/expenses/expenses-content";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

function mount() {
  return render(
    <TooltipProvider>
      <ScenarioProvider>
        <ExpensesContent />
      </ScenarioProvider>
    </TooltipProvider>,
  );
}

describe("ExpensesContent", () => {
  beforeEach(() => {
    resetTrpcMock();
    setQuery("budget.listApiCategories", {
      groups: [
        {
          id: "g-food",
          name: "Food",
          categories: [
            {
              id: "c-groceries",
              name: "Groceries",
              budgeted: 600,
              activity: -540.25,
              balance: 59.75,
            },
            {
              id: "c-dining",
              name: "Dining Out",
              budgeted: 150,
              activity: -210,
              balance: -60,
            },
          ],
        },
        {
          id: "g-home",
          name: "Home",
          categories: [
            {
              id: "c-power",
              name: "Electric",
              budgeted: 120,
              activity: -98.4,
              balance: 21.6,
            },
          ],
        },
      ],
    });
    setQuery("budget.listApiActuals", {
      actuals: [],
      service: "ynab",
      month: "2026-03",
      linkedProfileId: null,
      linkedColumnIndex: 0,
    });
  });

  it("shows the summary and one row per category group", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Expenses" })).toBeTruthy();
    expect(screen.getByText("Category Detail — This Month")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Food")).toBeTruthy();
    expect(within(table).getByText("Home")).toBeTruthy();
    // Collapsed: no category rows yet.
    expect(within(table).queryByText("Groceries")).toBeNull();
    expect(within(table).getByText("$848.65")).toBeTruthy();
  });

  it("expands a group's categories on its row's click", () => {
    mount();
    const table = screen.getByRole("table");
    fireEvent.click(within(table).getByText("Food").closest("tr")!);
    expect(within(table).getByText("Groceries")).toBeTruthy();
    expect(within(table).getByText("Dining Out")).toBeTruthy();
    expect(within(table).queryByText("Electric")).toBeNull();
    fireEvent.click(within(table).getByText("Food").closest("tr")!);
    expect(within(table).queryByText("Groceries")).toBeNull();
  });
});
