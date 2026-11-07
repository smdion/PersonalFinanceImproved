/**
 * Smoke test for the savings contribution grid (v0.10.4 commit 5b, before
 * 8 gives its cells a keyboard path): funds as columns and months as rows
 * render, a month's label opens that month, and an edited default
 * contribution reaches onGoalUpdateMulti, the input the page sends to
 * savings.savingsGoals.update.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ContributionGrid } from "@/components/savings/contribution-grid";
import type { GoalProjection } from "@/components/savings/types";

const monthDates = [new Date(2026, 3, 1), new Date(2026, 4, 1)];

function goal(goalId: number, name: string, monthly: number): GoalProjection {
  return {
    name,
    goalId,
    current: 100,
    target: 6000,
    targetMode: "fixed",
    monthlyAllocation: monthly,
    monthlyAllocations: [monthly, monthly],
    balances: [100 + monthly, 100 + monthly * 2],
    monthEvents: [null, null],
    hasOverride: [false, false],
  };
}

function mount() {
  const props = {
    goalProjections: [goal(1, "Vacation", 300), goal(2, "New car", 200)],
    monthDates,
    totalMonthlyAllocation: 500,
    maxMonthlyFunding: 500,
    monthlyPools: [500, 500],
    onGoalUpdate: vi.fn(),
    onGoalUpdateMulti: vi.fn(),
    onEditMonth: vi.fn(),
    canEdit: true,
  };
  render(<ContributionGrid {...props} />);
  return props;
}

describe("ContributionGrid", () => {
  it("shows funds as columns and months as rows", () => {
    mount();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Vacation")).toBeTruthy();
    expect(within(table).getByText("New car")).toBeTruthy();
    expect(within(table).getByText("Default /mo")).toBeTruthy();
    expect(within(table).getByText("Apr 1 '26")).toBeTruthy();
    expect(within(table).getByText("May 1 '26")).toBeTruthy();
    expect(
      within(table).getAllByTitle(
        "Click to change default monthly contribution",
      ),
    ).toHaveLength(2);
  });

  it("opens a month from its label", () => {
    const props = mount();
    fireEvent.click(screen.getByText("May 1 '26"));
    expect(props.onEditMonth).toHaveBeenCalledWith(monthDates[1]);
  });

  it("saves an edited default contribution with its share of the pool", () => {
    const props = mount();
    const [vacation] = screen.getAllByTitle(
      "Click to change default monthly contribution",
    );
    fireEvent.click(vacation!);
    const input = screen.getByDisplayValue("300");
    fireEvent.change(input, { target: { value: "400" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onGoalUpdateMulti).toHaveBeenCalledWith(1, {
      monthlyContribution: "400",
      allocationPercent: "80.000",
    });
  });
});
