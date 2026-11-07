/**
 * The report states the active strategy's own parameters — read from each
 * field's column — and where Social Security sits.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportAssumptionsSummary } from "@/components/retirement-projection/report/report-assumptions-summary";

describe("ReportAssumptionsSummary — strategy parameters", () => {
  it("Constant Percentage: its percentages, and Social Security from the switch", () => {
    render(
      <ReportAssumptionsSummary
        settings={{
          withdrawalStrategy: "constant_percentage",
          cpWithdrawalPercent: "0.045",
          cpFloorPercent: "0.9",
          cpSsInAmount: true,
        }}
      />,
    );
    expect(screen.getByText("4.5%")).toBeInTheDocument();
    expect(
      screen.getByText("comes out of the strategy's amount"),
    ).toBeInTheDocument();
  });

  it("VPW with nothing stored: Social Security on top (the published method)", () => {
    render(
      <ReportAssumptionsSummary
        settings={{ withdrawalStrategy: "vpw", vpwCap: "0.1" }}
      />,
    );
    expect(screen.getByText("on top of the withdrawal")).toBeInTheDocument();
    expect(screen.getByText("10.0%")).toBeInTheDocument();
  });
});
