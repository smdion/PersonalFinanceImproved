/**
 * Smoke test for a fund's timeline panel (v0.10.4 commit 5b, before 7
 * moves it onto a shared panel): each month's balance, allocation and
 * events render, and Edit month and Close reach their callbacks.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FundTimelineDetail } from "@/components/savings/fund-timeline-detail";
import type { GoalProjection } from "@/components/savings/types";

const monthDates = [
  new Date(2026, 10, 1),
  new Date(2026, 11, 1),
  new Date(2027, 0, 1),
];

const projection: GoalProjection = {
  name: "Vacation",
  goalId: 7,
  current: 1200,
  target: 3000,
  targetMode: "fixed",
  monthlyAllocation: 250,
  monthlyAllocations: [250, 400, 250],
  balances: [1450, 1850, -100],
  monthEvents: [
    null,
    null,
    [
      {
        id: "tx-1-2027-01",
        plannedTxId: 1,
        occurrenceMonth: "2027-01",
        amount: -2200,
        description: "Flights",
      },
    ],
  ],
  hasOverride: [false, true, false],
};

describe("FundTimelineDetail", () => {
  it("shows each month's balance, allocation and events", () => {
    render(
      <FundTimelineDetail
        projection={projection}
        monthDates={monthDates}
        onClose={vi.fn()}
        onEditMonth={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Vacation" })).toBeTruthy();
    expect(
      screen.getByText("$1,200.00 current • $3,000.00 target"),
    ).toBeTruthy();
    expect(screen.getByText("Nov 2026")).toBeTruthy();
    expect(screen.getByText("$1,850.00")).toBeTruthy();
    expect(screen.getByText("+$400.00/mo (this month)")).toBeTruthy();
    expect(screen.getByText("-$100.00")).toBeTruthy();
    expect(screen.getByText("Flights")).toBeTruthy();
    expect(screen.getByText("2027")).toBeTruthy();
  });

  it("edits a month and closes", () => {
    const onEditMonth = vi.fn();
    const onClose = vi.fn();
    render(
      <FundTimelineDetail
        projection={projection}
        monthDates={monthDates}
        onClose={onClose}
        onEditMonth={onEditMonth}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Edit month" })[1]!);
    expect(onEditMonth).toHaveBeenCalledWith(monthDates[1]);
    fireEvent.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides editing when the user can't edit", () => {
    render(
      <FundTimelineDetail
        projection={projection}
        monthDates={monthDates}
        onClose={vi.fn()}
        onEditMonth={vi.fn()}
        canEdit={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit month" })).toBeNull();
  });
});
