import { describe, it, expect } from "vitest";
import { annualRaiseLabel } from "@/lib/pure/raise-rates";

describe("annualRaiseLabel", () => {
  it("one rate when there's one person or the rates match", () => {
    expect(annualRaiseLabel(0.03)).toBe("3.0%");
    expect(
      annualRaiseLabel(0.03, [
        { name: "Ann", salaryAnnualIncrease: "0.03" },
        { name: "Bo", salaryAnnualIncrease: "0.03" },
      ]),
    ).toBe("3.0%");
  });

  it("each person's rate when they differ", () => {
    expect(
      annualRaiseLabel(0.1, [
        { name: "Ann", salaryAnnualIncrease: "0.1" },
        { name: "Bo", salaryAnnualIncrease: 0 },
      ]),
    ).toBe("Ann 10.0%, Bo 0.0%");
  });
});
