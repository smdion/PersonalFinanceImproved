import { describe, expect, it } from "vitest";
import {
  buildNonPayrollContributions,
  fixedContributionMonthly,
} from "@/components/budget/helpers";

describe("fixedContributionMonthly", () => {
  it("reads the value as entered", () => {
    expect(fixedContributionMonthly("fixed_annual", 6500, 26)).toBeCloseTo(
      541.67,
      2,
    );
    expect(fixedContributionMonthly("fixed_monthly", 300, 26)).toBe(300);
    expect(fixedContributionMonthly("fixed_per_period", 100, 26)).toBeCloseTo(
      216.67,
      2,
    );
  });
});

describe("buildNonPayrollContribs", () => {
  it("$6,500 a year is about $542 a month, not $14,083", () => {
    const map = buildNonPayrollContributions(
      [
        {
          paycheck: { periodsPerYear: 26 },
          job: {},
          rawContribs: [
            {
              id: 1,
              jobId: null,
              isPayrollDeducted: false,
              contributionValue: 6500,
              contributionMethod: "fixed_annual",
              accountType: "ira",
            },
          ],
        },
      ],
      new Set(),
    );
    expect(map.get("ira")).toBeCloseTo(541.67, 2);
  });
});
