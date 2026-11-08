import { describe, it, expect } from "vitest";
import { strategyChartRows } from "@/components/retirement-projection/withdrawal-comparison.model";

const strategies = [
  {
    strategy: "fixed",
    yearByYear: [
      { year: 2041, retirementBalance: 900, withdrawal: 40 },
      { year: 2040, retirementBalance: 1_000, withdrawal: 40 },
    ],
  },
  {
    strategy: "guyton_klinger",
    yearByYear: [{ year: 2040, retirementBalance: 1_000, withdrawal: 45 }],
  },
];
const half = (value: number) => value / 2;

describe("strategyChartRows", () => {
  it("merges the strategies into one row per year, in year order", () => {
    expect(strategyChartRows(strategies, "retirementBalance", half)).toEqual([
      { year: 2040, fixed: 500, guyton_klinger: 500 },
      { year: 2041, fixed: 450 },
    ]);
  });

  it("reads the withdrawal for the withdrawal metric", () => {
    expect(strategyChartRows(strategies, "withdrawal", (v) => v)[0]).toEqual({
      year: 2040,
      fixed: 40,
      guyton_klinger: 45,
    });
  });
});
