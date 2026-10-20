/**
 * A deduction's tax treatment, picked the way the pay stub lists it — the
 * presets map to the two flags the calculator reads, and changing one on a
 * row sends a single "taxTreatment" update. Invented deductions only.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeductionRow } from "@/components/paycheck/deduction-row";
import {
  DEDUCTION_PRESETS,
  deductionPresetFor,
} from "@/lib/config/paycheck-presets";

vi.mock("@/components/ui/inline-edit", () => ({
  InlineEdit: ({ value }: { value: string }) => <span>{value}</span>,
}));

describe("deduction presets", () => {
  it("every valid flag pair has a preset", () => {
    expect(deductionPresetFor({ isPretax: true, ficaExempt: true }).key).toBe(
      "section125",
    );
    expect(deductionPresetFor({ isPretax: true, ficaExempt: false }).key).toBe(
      "retirement",
    );
    expect(deductionPresetFor({ isPretax: false, ficaExempt: false }).key).toBe(
      "afterTax",
    );
    expect(new Set(DEDUCTION_PRESETS.map((p) => p.key)).size).toBe(
      DEDUCTION_PRESETS.length,
    );
  });

  it("changing a row's treatment sends one taxTreatment update", () => {
    const onUpdate = vi.fn();
    render(
      <DeductionRow
        row={{
          type: "real",
          name: "STD",
          amount: 30,
          raw: {
            id: 4,
            jobId: 1,
            deductionName: "STD",
            amountPerPeriod: "30",
            isPretax: true,
            ficaExempt: true,
          } as never,
        }}
        onUpdateDeduction={onUpdate}
      />,
    );
    const picker = screen.getByLabelText("How STD is taxed");
    expect(picker).toHaveValue("section125");
    fireEvent.change(picker, { target: { value: "afterTax" } });
    expect(onUpdate).toHaveBeenCalledWith(4, "taxTreatment", "afterTax");
  });
});
