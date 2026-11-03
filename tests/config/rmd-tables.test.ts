import { describe, it, expect } from "vitest";
import {
  UNIFORM_LIFETIME_TABLE,
  getRmdStartAge,
  getRmdFactor,
  computeRmdAmount,
} from "@/lib/config/rmd-tables";
import { UNIFORM_LIFETIME_PUBLISHED as PUBLISHED } from "../fixtures/irs-published/rmd-uniform-lifetime";

describe("getRmdStartAge — SECURE 2.0 Act cohorts", () => {
  it("returns 72 for birth year 1950 and earlier", () => {
    expect(getRmdStartAge(1950)).toBe(72);
    expect(getRmdStartAge(1940)).toBe(72);
    expect(getRmdStartAge(1920)).toBe(72);
  });

  it("returns 73 for birth years 1951–1959", () => {
    expect(getRmdStartAge(1951)).toBe(73);
    expect(getRmdStartAge(1955)).toBe(73);
    expect(getRmdStartAge(1959)).toBe(73);
  });

  it("returns 75 for birth year 1960 and later", () => {
    expect(getRmdStartAge(1960)).toBe(75);
    expect(getRmdStartAge(1970)).toBe(75);
    expect(getRmdStartAge(2000)).toBe(75);
  });

  it("handles boundary years correctly", () => {
    // The 1950/1951 boundary
    expect(getRmdStartAge(1950)).toBe(72);
    expect(getRmdStartAge(1951)).toBe(73);
    // The 1959/1960 boundary
    expect(getRmdStartAge(1959)).toBe(73);
    expect(getRmdStartAge(1960)).toBe(75);
  });
});

describe("getRmdFactor — Uniform Lifetime Table", () => {
  it("returns null for ages below 72", () => {
    expect(getRmdFactor(71)).toBeNull();
    expect(getRmdFactor(50)).toBeNull();
    expect(getRmdFactor(0)).toBeNull();
  });

  // Every cell against the publication, so a mistyped mid-table divisor
  // fails (Retirement "Data tests per shipped table"; audit RD1-RD3, RT04).
  it(`UNIFORM_LIFETIME_TABLE is ${PUBLISHED.cite}: all 49 cells, ages 72-120 [RET-02]`, () => {
    expect(Object.keys(PUBLISHED.value)).toHaveLength(49);
    expect(UNIFORM_LIFETIME_TABLE).toEqual(PUBLISHED.value);
  });

  it("returns the published divisor at every age 72-120 [RET-02]", () => {
    for (const [age, divisor] of Object.entries(PUBLISHED.value))
      expect(getRmdFactor(Number(age)), `age ${age}`).toBe(divisor);
  });

  it('uses the 120 divisor above 120 (Table III: "120 and over", 2.0) [RET-02]', () => {
    expect(getRmdFactor(125)).toBe(PUBLISHED.value[120]);
  });
});

// Direct pins (behavior baseline, v0.10.0): computeRmdAmount had no test
// of its own edges, only the answer key's hand amounts. Each PINS CURRENT
// BEHAVIOR; the divisors are Table III's (Pub 590-B (2025) App. B, p. 67).
describe("computeRmdAmount (pins current behavior)", () => {
  it("is the prior year-end balance over the divisor, rounded to cents", () => {
    // 100,000 / 27.4 = 3,649.6350 -> 3,649.64.
    expect(computeRmdAmount(100000, 72)).toBe(3649.64);
    // 250,000 / 24.6 = 10,162.6016 -> 10,162.60.
    expect(computeRmdAmount(250000, 75)).toBe(10162.6);
  });

  it("is null below the table (age 71), whatever the balance", () => {
    expect(computeRmdAmount(1000000, 71)).toBeNull();
  });

  it("uses the 120 divisor above 120", () => {
    expect(computeRmdAmount(10000, 130)).toBe(5000);
  });

  it("a zero balance owes 0 (not null)", () => {
    expect(computeRmdAmount(0, 80)).toBe(0);
  });

  it("a negative balance gives a negative amount (no floor here; callers gate on balance > 0)", () => {
    expect(computeRmdAmount(-20200, 80)).toBe(-1000);
  });

  it("a fractional age has no divisor: null", () => {
    expect(computeRmdAmount(100000, 72.5)).toBeNull();
  });
});
