/**
 * A budget cell's amount: saved amounts that aren't a list (written outside
 * the app) show the marker, never a crash.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetAmountText } from "@/components/budget/budget-amount-text";
import type { RawItem } from "@/components/budget/types";

const item = (amounts: unknown): RawItem => ({
  id: 1,
  category: "Food",
  subcategory: "Snacks",
  amounts: amounts as number[],
  isEssential: false,
});

describe("BudgetAmountText", () => {
  it("marks saved amounts that aren't a list, counted as $0", () => {
    for (const stored of [null, 500]) {
      const { unmount } = render(
        <BudgetAmountText item={item(stored)} col={0} amount={0} />,
      );
      expect(screen.getByText("?").getAttribute("title")).toBe(
        `Saved as ${JSON.stringify(stored)}, not a list of amounts; counts as $0`,
      );
      unmount();
    }
  });

  it("marks a column the saved amounts stop short of, counted as $0", () => {
    render(<BudgetAmountText item={item([100])} col={1} amount={0} />);
    expect(screen.getByText("?").getAttribute("title")).toBe(
      "No saved amount for this column; counts as $0",
    );
  });

  it("shows a readable amount", () => {
    render(<BudgetAmountText item={item([250])} col={0} amount={250} />);
    expect(screen.getByText("$250.00")).toBeTruthy();
  });
});
