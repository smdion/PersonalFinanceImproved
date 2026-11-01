/** The assumptions the projection chart's tooltip shows: what a year's
 *  return is really drawn from, and the Guyton-Klinger anchor. */
import { describe, expect, it } from "vitest";
import {
  blendedReturnStats,
  buildCorrelationMatrix,
  choleskyDecomposition,
  createPRNG,
  sampleBlendedReturn,
} from "@/lib/calculators/random";
import { gkAnchorRate } from "@/lib/pure/gk-anchor-rate";

const classes = [
  { id: 1, name: "Stocks", meanReturn: 0.1, stdDev: 0.18 },
  { id: 2, name: "Bonds", meanReturn: 0.04, stdDev: 0.06 },
];
const correlations = [{ classAId: 1, classBId: 2, correlation: 0.2 }];
const glidePath = [
  { age: 40, allocations: { 1: 0.9, 2: 0.1 } },
  { age: 60, allocations: { 1: 0.5, 2: 0.5 } },
];
const corr = buildCorrelationMatrix(classes as never, correlations);

describe("blendedReturnStats", () => {
  it("interpolates the glide path by age", () => {
    const at = blendedReturnStats(classes as never, corr, glidePath, 50)!;
    expect(at.expectedReturn).toBeCloseTo(0.7 * 0.1 + 0.3 * 0.04, 10);
  });

  it("matches what the trials actually draw", () => {
    const stats = blendedReturnStats(classes as never, corr, glidePath, 50)!;
    const rng = createPRNG(42);
    const chol = choleskyDecomposition(corr);
    const n = 200_000;
    const draws = Array.from({ length: n }, () =>
      sampleBlendedReturn(rng, classes as never, chol, glidePath, 50),
    );
    const mean = draws.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(draws.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
    expect(stats.expectedReturn).toBeCloseTo(mean, 2);
    expect(stats.volatility).toBeCloseTo(sd, 2);
  });

  it("is null with nothing to blend", () => {
    expect(blendedReturnStats([], [], glidePath, 50)).toBeNull();
  });
});

describe("gkAnchorRate", () => {
  const accum = { phase: "accumulation", retirementBalance: 1_000_000 };
  const first = {
    phase: "decumulation",
    retirementBalance: 950_000,
    projectedExpenses: 60_000,
    ssIncome: 20_000,
  };
  it("is the first draw over the balance carried in", () => {
    expect(gkAnchorRate([accum, first])).toBeCloseTo(0.04, 10);
  });
  it("is null while Social Security covers it, or already retired", () => {
    expect(gkAnchorRate([accum, { ...first, ssIncome: 60_000 }])).toBeNull();
    expect(gkAnchorRate([first])).toBeNull();
  });
});
