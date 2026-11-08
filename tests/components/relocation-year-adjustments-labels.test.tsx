/**
 * The relocation year-adjustment form's labels reach their fields.
 */
import { describe, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RelocationYearAdjustments } from "@/components/tools/relocation/year-adjustments";
import { expectLabelReachesControl } from "./label-click";

describe("RelocationYearAdjustments labels", () => {
  it("clicking Year, Source, Monthly Expenses and Notes reaches each field", () => {
    render(
      <RelocationYearAdjustments
        budgetInfo={{ profiles: [] } as never}
        relocYearAdjustments={[]}
        setRelocYearAdjustments={vi.fn()}
        relocAdjMode="manual"
        setRelocAdjMode={vi.fn()}
        relocAdjForm={{
          year: "2030",
          monthlyExpenses: "",
          profileId: "",
          budgetColumn: "",
          notes: "",
        }}
        setRelocAdjForm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("+ Add Adjustment"));
    for (const name of ["Year", "Source", "Monthly Expenses", "Notes"])
      expectLabelReachesControl(name);
  });
});
