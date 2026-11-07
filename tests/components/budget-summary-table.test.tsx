/**
 * Smoke test for the Budget page's summary table (v0.10.4 commit 5b,
 * before 8 gives its rows a keyboard path): one column per budget mode,
 * the paycheck rows, a subtotal that expands to its lines, and a mode's
 * header that makes it active. The table writes nothing itself: the
 * header's click is the page's budget-column setting.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BudgetSummaryTable } from "@/components/budget/budget-summary-table";
import type { PayrollBreakdown } from "@/components/budget/types";

const payroll: PayrollBreakdown = {
  grossMonthly: 9000,
  federalWithholding: 900,
  ficaSS: 558,
  ficaMedicare: 130.5,
  totalTaxes: 1588.5,
  preTaxLines: [
    { name: "401k", monthly: 750 },
    { name: "HSA", monthly: 300 },
  ],
  totalPreTax: 1050,
  postTaxLines: [],
  totalPostTax: 0,
  netMonthly: 6361.5,
  takeHomeLines: [{ name: "Avery", monthly: 6361.5 }],
  grossLines: [{ name: "Avery", monthly: 9000 }],
  budgetNote: "",
};

function mount(onSetActiveColumn = vi.fn()) {
  render(
    <TooltipProvider>
      <BudgetSummaryTable
        cols={["Standard", "Lean"]}
        activeColumn={0}
        onSetActiveColumn={onSetActiveColumn}
        allColumnResults={[
          {
            totalMonthly: 5200,
            essentialTotal: 3900,
            discretionaryTotal: 1300,
          },
          { totalMonthly: 4100, essentialTotal: 3600, discretionaryTotal: 500 },
        ]}
        payrollBreakdowns={[payroll, payroll]}
        columnMonths={null}
        sinkingFunds={[{ id: 1, name: "New roof", monthlyContribution: 150 }]}
      />
    </TooltipProvider>,
  );
  return onSetActiveColumn;
}

describe("BudgetSummaryTable", () => {
  it("shows one column per mode and the paycheck rows", () => {
    mount();
    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).toEqual(["", "Standard●", "Lean"]);
    expect(within(table).getByText("Gross Income")).toBeTruthy();
    expect(within(table).getByText("Taxes")).toBeTruthy();
    expect(within(table).getAllByText("$9,000.00")).toHaveLength(2);
    expect(within(table).getAllByText("−$1,588.50")).toHaveLength(2);
  });

  it("expands the pre-tax deductions to their lines", () => {
    mount();
    const table = screen.getByRole("table");
    expect(within(table).queryByText("401k")).toBeNull();
    fireEvent.click(
      within(table).getByText("Pre-Tax Deductions").closest("tr")!,
    );
    expect(within(table).getByText("401k")).toBeTruthy();
    expect(within(table).getByText("HSA")).toBeTruthy();
  });

  it("makes a mode active from its header", () => {
    const onSetActiveColumn = mount();
    fireEvent.click(screen.getByTitle("Set Lean as active mode"));
    expect(onSetActiveColumn).toHaveBeenCalledWith(1);
  });
});
