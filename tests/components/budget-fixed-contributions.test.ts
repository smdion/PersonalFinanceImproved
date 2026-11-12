import { describe, expect, it } from "vitest";
import { buildNonPayrollContributions } from "@/components/budget/helpers";

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
