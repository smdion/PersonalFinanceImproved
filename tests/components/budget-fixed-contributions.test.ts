import { describe, expect, it } from "vitest";
import {
  buildNonPayrollContributions,
  jointContributionMonthly,
} from "@/components/budget/helpers";

describe("jointContributionMonthly", () => {
  it("reads a fixed amount as entered, a per-check one on the first paycheck's schedule", () => {
    expect(jointContributionMonthly("fixed_annual", 6500, 26)).toBeCloseTo(
      541.67,
      2,
    );
    expect(jointContributionMonthly("fixed_monthly", 300.1, 26)).toBe(300.1);
    expect(jointContributionMonthly("fixed_per_period", 100, 26)).toBeCloseTo(
      216.67,
      2,
    );
  });

  it("a percent on a joint account is $0 a month, not value ÷ 12 (C1: joint money has no pay of its own)", () => {
    expect(jointContributionMonthly("percent_of_salary", 6, 26)).toBe(0);
  });

  it("today: a per-check amount with no paycheck reads as value ÷ 12", () => {
    expect(jointContributionMonthly("fixed_per_period", 120, undefined)).toBe(
      10,
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
