/** Performance table → index column cell. Invented numbers only. */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BenchmarkCell } from "@/components/performance/benchmark-cell";

const prices = new Map<string, number>([["2019-12", 100]]);
for (let m = 1; m <= 12; m++)
  prices.set(`2020-${String(m).padStart(2, "0")}`, 100 * 1.01 ** m);
const benchmark = { key: "sp500", label: "S&P 500", prices, onChange: vi.fn() };
const row = {
  year: 2020,
  beginningBalance: 1000,
  totalContributions: 0,
  rollovers: 0,
  distributions: 0,
  fees: 0,
  yearlyGainLoss: 150,
  endingBalance: 1150,
  annualReturnPct: 0.15,
};

const renderCell = (r = row) =>
  render(
    <table>
      <tbody>
        <tr>
          <BenchmarkCell benchmark={benchmark} row={r} />
        </tr>
      </tbody>
    </table>,
  );

describe("BenchmarkCell", () => {
  it("shows the index's return for the same money and how far ahead you were", () => {
    renderCell();
    // Index ≈ 12.7%; you 15.0% → +2.3 points.
    expect(screen.getByText(/12\.7%/)).toBeInTheDocument();
    expect(screen.getByText("+2.3")).toBeInTheDocument();
  });

  it("shows a dash for a year the index has no prices for", () => {
    renderCell({ ...row, year: 2031 });
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
