/** Performance → realized vs assumed card. Invented data only. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { resetTrpcMock, setQuery } from "./trpc-mock";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

beforeEach(() => {
  resetTrpcMock();
  setQuery("performance.computeSummary", {
    annualRows: [
      { category: "Portfolio", year: 2019, annualReturnPct: 0.1 },
      { category: "Portfolio", year: 2020, annualReturnPct: 0.2 },
      { category: "Retirement", year: 2020, annualReturnPct: 0.9 },
    ],
  });
  setQuery("retirement.returnRates.list", [{ age: 30, rateOfReturn: "0.08" }]);
  setQuery("people.list", [{ id: 1, dateOfBirth: "1985-01-01" }]);
});

const { RealizedVsAssumedCard } =
  await import("@/components/performance/realized-vs-assumed-card");

describe("RealizedVsAssumedCard", () => {
  it("compares the Portfolio's compounded return with the assumed rate", () => {
    render(<RealizedVsAssumedCard />);
    // √(1.1 × 1.2) − 1 ≈ 14.9% vs 8.0% → +6.9 points.
    expect(screen.getByText("14.9%")).toBeInTheDocument();
    expect(screen.getByText("+6.9 points")).toBeInTheDocument();
  });
});
