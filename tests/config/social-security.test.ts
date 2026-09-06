import { describe, it, expect } from "vitest";
import {
  getFullRetirementAge,
  fraToMonths,
  getClaimingAdjustmentMultiplier,
  getSpousalAdjustmentMultiplier,
  SPOUSAL_BENEFIT_BASE_RATE,
} from "@/lib/config/social-security";

describe("getFullRetirementAge — SSA birth-year cohorts", () => {
  it("returns 65y0m for 1937 and earlier", () => {
    expect(getFullRetirementAge(1937)).toEqual({ years: 65, months: 0 });
    expect(getFullRetirementAge(1900)).toEqual({ years: 65, months: 0 });
  });

  it("slides 2 months per year through the 1938-1942 transition", () => {
    expect(getFullRetirementAge(1938)).toEqual({ years: 65, months: 2 });
    expect(getFullRetirementAge(1939)).toEqual({ years: 65, months: 4 });
    expect(getFullRetirementAge(1940)).toEqual({ years: 65, months: 6 });
    expect(getFullRetirementAge(1941)).toEqual({ years: 65, months: 8 });
    expect(getFullRetirementAge(1942)).toEqual({ years: 65, months: 10 });
  });

  it("plateaus at 66y0m for 1943-1954", () => {
    expect(getFullRetirementAge(1943)).toEqual({ years: 66, months: 0 });
    expect(getFullRetirementAge(1950)).toEqual({ years: 66, months: 0 });
    expect(getFullRetirementAge(1954)).toEqual({ years: 66, months: 0 });
  });

  it("slides 2 months per year through the 1955-1959 transition", () => {
    expect(getFullRetirementAge(1955)).toEqual({ years: 66, months: 2 });
    expect(getFullRetirementAge(1959)).toEqual({ years: 66, months: 10 });
  });

  it("returns 67y0m for 1960 and later", () => {
    expect(getFullRetirementAge(1960)).toEqual({ years: 67, months: 0 });
    expect(getFullRetirementAge(2000)).toEqual({ years: 67, months: 0 });
  });
});

describe("fraToMonths", () => {
  it("converts years+months to a total month count", () => {
    expect(fraToMonths({ years: 66, months: 0 })).toBe(792);
    expect(fraToMonths({ years: 66, months: 10 })).toBe(802);
    expect(fraToMonths({ years: 67, months: 0 })).toBe(804);
  });
});

// Expected percentages below are SSA's own published "early or late
// retirement" benefit-percentage tables (ssa.gov), not hand-derived —
// this is the golden-file check the plan doc requires before wiring this
// into the engine.
describe("getClaimingAdjustmentMultiplier — FRA 66 (born 1943-1954)", () => {
  const fra = { years: 66, months: 0 };

  it("age 62 (48 months early) => 75.0% of PIA", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 62 * 12)).toBeCloseTo(0.75, 5);
  });

  it("age 63 (36 months early) => 80.0% of PIA", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 63 * 12)).toBeCloseTo(0.8, 5);
  });

  it("age 64 (24 months early) => 86.7% of PIA", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 64 * 12)).toBeCloseTo(
      0.8667,
      3,
    );
  });

  it("age 65 (12 months early) => 93.3% of PIA", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 65 * 12)).toBeCloseTo(
      0.9333,
      3,
    );
  });

  it("age 66 (exactly FRA) => 100% of PIA", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 66 * 12)).toBe(1);
  });

  it("age 70 (48 months delayed) => 132.0% of PIA", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 70 * 12)).toBeCloseTo(1.32, 5);
  });
});

describe("getClaimingAdjustmentMultiplier — FRA 67 (born 1960+)", () => {
  const fra = { years: 67, months: 0 };

  it("age 62 (60 months early) => 70.0% of PIA", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 62 * 12)).toBeCloseTo(0.7, 5);
  });

  it("age 65 (24 months early) => 86.7% of PIA", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 65 * 12)).toBeCloseTo(
      0.8667,
      3,
    );
  });

  it("age 67 (exactly FRA) => 100% of PIA", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 67 * 12)).toBe(1);
  });

  it("age 70 (36 months delayed) => 124.0% of PIA", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 70 * 12)).toBeCloseTo(1.24, 5);
  });
});

// Expected percentages below are SSA's own published spousal-benefit
// percentage-of-worker's-PIA tables — a DIFFERENT reduction rate than the
// worker's own benefit, and no delayed credit past FRA (capped at 1 there).
describe("getSpousalAdjustmentMultiplier — FRA 66 (born 1943-1954)", () => {
  const fra = { years: 66, months: 0 };

  it("age 62 (48 months early) => 35.0% of PIA total (base 50% x 0.70)", () => {
    const multiplier = getSpousalAdjustmentMultiplier(fra, 62 * 12);
    expect(multiplier * SPOUSAL_BENEFIT_BASE_RATE).toBeCloseTo(0.35, 3);
  });

  it("age 63 (36 months early) => 37.8% of PIA total", () => {
    const multiplier = getSpousalAdjustmentMultiplier(fra, 63 * 12);
    expect(multiplier * SPOUSAL_BENEFIT_BASE_RATE).toBeCloseTo(0.378, 2);
  });

  it("age 64 (24 months early) => 41.7% of PIA total", () => {
    const multiplier = getSpousalAdjustmentMultiplier(fra, 64 * 12);
    expect(multiplier * SPOUSAL_BENEFIT_BASE_RATE).toBeCloseTo(0.417, 2);
  });

  it("age 65 (12 months early) => 45.8% of PIA total", () => {
    const multiplier = getSpousalAdjustmentMultiplier(fra, 65 * 12);
    expect(multiplier * SPOUSAL_BENEFIT_BASE_RATE).toBeCloseTo(0.458, 2);
  });

  it("age 66 (exactly FRA) => 50.0% of PIA total, the uncapped base", () => {
    const multiplier = getSpousalAdjustmentMultiplier(fra, 66 * 12);
    expect(multiplier).toBe(1);
    expect(multiplier * SPOUSAL_BENEFIT_BASE_RATE).toBe(0.5);
  });

  it("age 70 (delayed) earns NO extra credit — still capped at 50%", () => {
    const multiplier = getSpousalAdjustmentMultiplier(fra, 70 * 12);
    expect(multiplier).toBe(1);
  });
});

describe("getSpousalAdjustmentMultiplier — FRA 67 (born 1960+)", () => {
  const fra = { years: 67, months: 0 };

  it("age 62 (60 months early) => 32.5% of PIA total", () => {
    const multiplier = getSpousalAdjustmentMultiplier(fra, 62 * 12);
    expect(multiplier * SPOUSAL_BENEFIT_BASE_RATE).toBeCloseTo(0.325, 3);
  });
});

describe("getClaimingAdjustmentMultiplier — clamping", () => {
  const fra = { years: 67, months: 0 };

  it("clamps claiming ages below 62 to age 62's multiplier", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 60 * 12)).toBeCloseTo(
      getClaimingAdjustmentMultiplier(fra, 62 * 12),
      10,
    );
  });

  it("clamps claiming ages above 70 to age 70's multiplier", () => {
    expect(getClaimingAdjustmentMultiplier(fra, 75 * 12)).toBeCloseTo(
      getClaimingAdjustmentMultiplier(fra, 70 * 12),
      10,
    );
  });
});
