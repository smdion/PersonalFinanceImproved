/**
 * Smoke test for a savings month's override dialog (v0.10.4 commit 5b,
 * before 7 moves it onto Modal): the month's funds render with their
 * amounts, and a changed amount reaches onUpsertMonth (applied to the
 * month) or onUpsertMonthRange (filled forward), the inputs the page sends
 * to the savings allocation-override mutations.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MonthOverrideModal } from "@/components/savings/month-override-modal";
import type { GoalProjection } from "@/components/savings/types";

const monthDates = [
  new Date(2026, 3, 1),
  new Date(2026, 4, 1),
  new Date(2026, 5, 1),
];

function goal(goalId: number, name: string, monthly: number): GoalProjection {
  return {
    name,
    goalId,
    current: 0,
    target: 5000,
    targetMode: "fixed",
    monthlyAllocation: monthly,
    monthlyAllocations: [monthly, monthly, monthly],
    balances: [monthly, monthly * 2, monthly * 3],
    monthEvents: [null, null, null],
    hasOverride: [false, false, false],
  };
}

const goals = [goal(1, "Vacation", 300), goal(2, "New car", 200)];

function mount(overrides: Partial<Parameters<typeof MonthOverrideModal>[0]>) {
  const props = {
    monthDate: monthDates[1]!,
    monthDates,
    goalProjections: goals,
    pool: 500,
    onUpsertMonth: vi.fn(),
    onUpsertMonthRange: vi.fn(),
    onDeleteMonthOverrides: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<MonthOverrideModal {...props} />);
  return props;
}

/** Sets a fund's dollar amount through its amount button. */
function setAmount(current: string, next: string) {
  fireEvent.click(screen.getByRole("button", { name: current }));
  const input = screen.getByDisplayValue(
    current.replace(/[$,]/g, "").replace(/\.00$/, ""),
  );
  fireEvent.change(input, { target: { value: next } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("MonthOverrideModal", () => {
  it("shows the month's funds and their amounts", () => {
    mount({});
    expect(screen.getByText("Vacation")).toBeTruthy();
    expect(screen.getByText("New car")).toBeTruthy();
    expect(screen.getByRole("button", { name: "$300.00" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Apply this month" }),
    ).toBeDisabled();
  });

  it("applies a changed amount to the month", () => {
    const props = mount({});
    setAmount("$300.00", "250");
    setAmount("$200.00", "250");
    fireEvent.click(screen.getByRole("button", { name: "Apply this month" }));
    expect(props.onUpsertMonth).toHaveBeenCalledWith({
      monthDate: "2026-05-01",
      allocations: [
        { goalId: 1, amount: 250 },
        { goalId: 2, amount: 250 },
      ],
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("fills a changed amount forward", () => {
    const props = mount({});
    setAmount("$300.00", "250");
    setAmount("$200.00", "250");
    fireEvent.click(screen.getByRole("button", { name: "Fill forward" }));
    expect(props.onUpsertMonthRange).toHaveBeenCalledWith({
      startMonth: "2026-05-01",
      endMonth: null,
      monthDates: ["2026-04-01", "2026-05-01", "2026-06-01"],
      allocations: [
        { goalId: 1, amount: 250 },
        { goalId: 2, amount: 250 },
      ],
    });
  });
});
