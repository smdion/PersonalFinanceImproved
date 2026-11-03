import { describe, it, expect } from "vitest";
import {
  UNIFORM_LIFETIME_TABLE,
  getRmdStartAge,
  getRmdFactor,
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
