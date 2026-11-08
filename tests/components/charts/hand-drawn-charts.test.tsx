import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as axe from "axe-core";
import { FundingBar } from "@/components/paycheck/funding-bar";
import { ReportRiskBandChart } from "@/components/retirement-projection/report/report-risk-band-chart";

async function violations(container: HTMLElement) {
  const results = await axe.run(
    container as axe.ElementContext,
    { rules: { "color-contrast": { enabled: false } } } as axe.RunOptions,
  );
  return results.violations.map((v) => v.id);
}

describe("hand-drawn charts", () => {
  it.each([
    ["without", 0],
    ["with", 0.2],
  ])(
    "the funding bar %s a match beyond it is an image described by its summary",
    async (_c, matchPct) => {
      const { container } = render(
        <FundingBar pct={0.5} matchPct={matchPct} accountType="401k" />,
      );
      const bar = screen.getByRole("img", {
        name: "Funding toward the IRS limit",
      });
      expect(bar).toHaveAccessibleDescription(
        /^Employee contribution: 50% of IRS limit\./,
      );
      expect(await violations(container)).toEqual([]);
    },
  );

  it("the report's risk band keeps its name and gains its summary", async () => {
    const { container } = render(
      <ReportRiskBandChart
        points={[
          {
            year: 2040,
            age: 60,
            low: 500_000,
            median: 900_000,
            high: 1_400_000,
          },
          { year: 2080, age: 100, low: 0, median: 600_000, high: 2_100_000 },
        ]}
      />,
    );
    const chart = screen.getByRole("img", { name: /^Portfolio balance range/ });
    expect(chart).toHaveAccessibleDescription(
      /, 2040 to 2080, on a scale from \$0 to /,
    );
    expect(await violations(container)).toEqual([]);
  });
});
