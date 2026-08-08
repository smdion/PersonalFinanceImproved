/**
 * T6 — src/components/savings/fund-overrides-summary.tsx had no test
 * coverage for its `collapseOverrides()` range-merging logic (only
 * indirectly reachable through the rendered "Monthly Overrides" panel).
 * Uses far-future months (2099+) so every override always lands in
 * `currentRanges`, not `pastRanges`, regardless of when the test runs.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FundOverridesSummary } from "@/components/savings/fund-overrides-summary";

function openPanel() {
  fireEvent.click(screen.getByText(/Monthly Overrides/));
}

describe("FundOverridesSummary — collapseOverrides via render", () => {
  it("collapses contiguous same-amount overrides into a single range", () => {
    const onDeleteOverride = vi.fn();
    render(
      <FundOverridesSummary
        overrides={[
          { goalId: 1, monthDate: "2099-01-01", amount: 500 },
          { goalId: 1, monthDate: "2099-02-01", amount: 500 },
          { goalId: 1, monthDate: "2099-03-01", amount: 500 },
        ]}
        goalId={1}
        defaultAllocation={300}
        onDeleteOverride={onDeleteOverride}
        onEditMonth={vi.fn()}
      />,
    );
    openPanel();

    // Collapsed into one range label ("Jan–Mar 2099"), not three separate rows.
    expect(screen.getByText("Jan–Mar 2099")).toBeInTheDocument();
    expect(screen.getByText("$500.00/mo")).toBeInTheDocument();
  });

  it("splits into separate ranges when the amount changes", () => {
    render(
      <FundOverridesSummary
        overrides={[
          { goalId: 1, monthDate: "2099-01-01", amount: 500 },
          { goalId: 1, monthDate: "2099-02-01", amount: 750 },
        ]}
        goalId={1}
        defaultAllocation={300}
        onDeleteOverride={vi.fn()}
        onEditMonth={vi.fn()}
      />,
    );
    openPanel();

    expect(screen.getByText("Jan 2099")).toBeInTheDocument();
    expect(screen.getByText("Feb 2099")).toBeInTheDocument();
    expect(screen.getByText("$500.00/mo")).toBeInTheDocument();
    expect(screen.getByText("$750.00/mo")).toBeInTheDocument();
  });

  it("splits into separate ranges when there's a gap month", () => {
    render(
      <FundOverridesSummary
        overrides={[
          { goalId: 1, monthDate: "2099-01-01", amount: 500 },
          // February skipped
          { goalId: 1, monthDate: "2099-03-01", amount: 500 },
        ]}
        goalId={1}
        defaultAllocation={300}
        onDeleteOverride={vi.fn()}
        onEditMonth={vi.fn()}
      />,
    );
    openPanel();

    expect(screen.getByText("Jan 2099")).toBeInTheDocument();
    expect(screen.getByText("Mar 2099")).toBeInTheDocument();
  });

  it("ignores overrides belonging to a different goalId", () => {
    render(
      <FundOverridesSummary
        overrides={[
          { goalId: 1, monthDate: "2099-01-01", amount: 500 },
          { goalId: 2, monthDate: "2099-02-01", amount: 999 },
        ]}
        goalId={1}
        defaultAllocation={300}
        onDeleteOverride={vi.fn()}
        onEditMonth={vi.fn()}
      />,
    );
    openPanel();

    expect(screen.getByText("Jan 2099")).toBeInTheDocument();
    expect(screen.queryByText("$999.00/mo")).not.toBeInTheDocument();
  });

  it("shows the default-only message when there are no overrides", () => {
    render(
      <FundOverridesSummary
        overrides={[]}
        goalId={1}
        defaultAllocation={300}
        onDeleteOverride={vi.fn()}
        onEditMonth={vi.fn()}
      />,
    );
    openPanel();

    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "P" &&
          (el.textContent ?? "").includes("No overrides. Default: $300.00/mo"),
      ),
    ).toBeInTheDocument();
  });

  it("clicking clear deletes every month in the collapsed range, not just the first", () => {
    const onDeleteOverride = vi.fn();
    render(
      <FundOverridesSummary
        overrides={[
          { goalId: 1, monthDate: "2099-01-01", amount: 500 },
          { goalId: 1, monthDate: "2099-02-01", amount: 500 },
          { goalId: 1, monthDate: "2099-03-01", amount: 500 },
        ]}
        goalId={1}
        defaultAllocation={300}
        onDeleteOverride={onDeleteOverride}
        onEditMonth={vi.fn()}
      />,
    );
    openPanel();

    fireEvent.click(screen.getByText("clear"));

    expect(onDeleteOverride).toHaveBeenCalledTimes(3);
    expect(onDeleteOverride).toHaveBeenCalledWith({
      goalId: 1,
      monthDate: "2099-01-01",
    });
    expect(onDeleteOverride).toHaveBeenCalledWith({
      goalId: 1,
      monthDate: "2099-02-01",
    });
    expect(onDeleteOverride).toHaveBeenCalledWith({
      goalId: 1,
      monthDate: "2099-03-01",
    });
  });
});
