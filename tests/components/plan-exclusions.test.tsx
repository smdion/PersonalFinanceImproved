/**
 * The Retirement page's "doesn't include" list renders every config line,
 * the average-cost disclosure among them.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanExclusions } from "@/components/retirement/plan-exclusions";
import { PLAN_EXCLUSIONS } from "@/lib/config/plan-exclusions";

describe("PlanExclusions", () => {
  it("lists each line of the config under one summary", () => {
    render(<PlanExclusions />);
    expect(screen.getByText("What this plan doesn't include")).toBeTruthy();
    expect(screen.getAllByRole("listitem", { hidden: true })).toHaveLength(
      PLAN_EXCLUSIONS.length,
    );
    expect(
      PLAN_EXCLUSIONS.some((line) => line.includes("(average cost)")),
    ).toBe(true);
  });
});
