import { describe, it, expect } from "vitest";
import { isInRetirementPerformanceRollup } from "@/lib/config/account-types";

describe("isInRetirementPerformanceRollup", () => {
  it("401k account type is always in the rollup, regardless of parentCategory", () => {
    expect(isInRetirementPerformanceRollup("401k", "Retirement")).toBe(true);
    expect(isInRetirementPerformanceRollup("401k", "Portfolio")).toBe(true);
    expect(isInRetirementPerformanceRollup("401k", undefined)).toBe(true);
  });

  it("HSA account type is always in the rollup, regardless of parentCategory", () => {
    expect(isInRetirementPerformanceRollup("hsa", "Portfolio")).toBe(true);
  });

  it("Brokerage account type is in the rollup only when parentCategory is Retirement", () => {
    expect(isInRetirementPerformanceRollup("brokerage", "Retirement")).toBe(
      true,
    );
    expect(isInRetirementPerformanceRollup("brokerage", "Portfolio")).toBe(
      false,
    );
    expect(isInRetirementPerformanceRollup("brokerage", undefined)).toBe(false);
  });

  it("an unrecognized account type falls back to the default performance category and follows Brokerage-style gating", () => {
    // accountTypeToPerformanceCategory falls back to PERF_CATEGORY_DEFAULT
    // ("401k/IRA") for unmapped account types — which IS a fully-retirement
    // category, so it's always in the rollup.
    expect(isInRetirementPerformanceRollup("unknown_type", "Portfolio")).toBe(
      true,
    );
  });

  it("null account type follows the same default-category fallback", () => {
    expect(isInRetirementPerformanceRollup(null, "Portfolio")).toBe(true);
  });
});
