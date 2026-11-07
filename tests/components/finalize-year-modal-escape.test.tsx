/**
 * Escape in the Finalize-year dialog: inside an edited figure it ends that
 * edit only; anywhere else it cancels the dialog, as its backdrop does.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FinalizeYearModal } from "@/components/performance/finalize-year-modal";
import type { AnnualRow } from "@/components/performance/types";

afterEach(() => {
  cleanup();
});

const row: AnnualRow = {
  id: 1,
  year: 2026,
  category: "HSA",
  beginningBalance: 9000,
  totalContributions: 1200,
  yearlyGainLoss: 300,
  endingBalance: 10500,
  annualReturnPct: 0.03,
  employerContributions: 0,
  distributions: 0,
  fees: 0,
  rollovers: 0,
  lifetimeGains: 800,
  lifetimeContributions: 9700,
  lifetimeMatch: 0,
  isCurrentYear: true,
  isFinalized: false,
};

describe("FinalizeYearModal Escape", () => {
  it("ends a cell's edit without cancelling, then cancels", () => {
    const onCancel = vi.fn();
    render(
      <FinalizeYearModal
        year={2026}
        rows={[row]}
        onConfirm={vi.fn()}
        onCancel={onCancel}
        isPending={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "$10,500.00" }));
    const input = screen.getByDisplayValue("10500.00");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByDisplayValue("10500.00")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
