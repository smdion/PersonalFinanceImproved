/**
 * simulatedOrBaseline — the one rule for showing a nest egg.
 */
import { describe, it, expect } from "vitest";
import {
  baselineNestEgg,
  simulatedOrBaseline,
} from "@/lib/pure/nest-egg-display";

const bands = [
  { age: 60, year: 2050, p25: 800_000, p50: 1_000_000, p75: 1_300_000 },
  { age: 90, year: 2080, p25: 0, p50: 400_000, p75: 900_000 },
];
// Halve every nominal figure: stands in for "today's dollars".
const toDisplay = (value: number) => value / 2;

describe("simulatedOrBaseline", () => {
  it("the simulation's median and middle-half range at the target age, baseline alongside", () => {
    expect(
      simulatedOrBaseline({
        bands,
        baseline: 450_000,
        targetAge: 60,
        toDisplay,
        personFiltered: false,
      }),
    ).toEqual({
      kind: "simulated",
      median: 500_000,
      low: 400_000,
      high: 650_000,
      baseline: 450_000,
    });
  });

  it("the baseline when there's no simulation for these inputs", () => {
    expect(
      simulatedOrBaseline({
        bands: null,
        baseline: 450_000,
        targetAge: 60,
        toDisplay,
        personFiltered: false,
      }),
    ).toEqual({ kind: "baseline", baseline: 450_000 });
  });

  it("the baseline for a person filter — the simulation is the whole household's", () => {
    expect(
      simulatedOrBaseline({
        bands,
        baseline: 200_000,
        targetAge: 60,
        toDisplay,
        personFiltered: true,
      }).kind,
    ).toBe("baseline");
  });
});

describe("baselineNestEgg", () => {
  const years = [
    { age: 40, year: 2030, retirementBalance: 500_000 },
    { age: 55, year: 2045, retirementBalance: 2_000_000.37 },
  ];
  it("the engine's retirement money at the target age, with its year", () => {
    expect(baselineNestEgg(years, 55)).toEqual({
      nominal: 2_000_000.37,
      year: 2045,
    });
  });
  it("null when the projection has no year at that age", () => {
    expect(baselineNestEgg(years, 60)).toBeNull();
  });
});
