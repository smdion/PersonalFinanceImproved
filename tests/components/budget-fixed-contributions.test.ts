import { describe, expect, it } from "vitest";
import { buildNonPayrollContributions } from "@/components/budget/helpers";

describe("buildNonPayrollContribs", () => {
  it("$6,500 a year is about $542 a month, not $14,083", () => {
    const map = buildNonPayrollContributions(
      [
        {
          paycheck: { periodsPerYear: 26 },
          job: { payPeriod: "biweekly" },
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

  it("a per-check amount is a year of the pay schedule's checks, not the year's paydays", () => {
    // A 27-payday year: $100 a check is 26 × 100 / 12 = $216.67 a month, as Contributions counts it.
    const map = buildNonPayrollContributions(
      [
        {
          paycheck: { periodsPerYear: 27 },
          job: { payPeriod: "biweekly" },
          rawContribs: [
            {
              id: 2,
              jobId: 1,
              isPayrollDeducted: false,
              contributionValue: 100,
              contributionMethod: "fixed_per_period",
              accountType: "brokerage",
            },
          ],
        },
      ],
      new Set(),
    );
    expect(map.get("brokerage")).toBeCloseTo(216.67, 2);
  });
});
