import { describe, it, expect } from "vitest";
import { getRmdStartAge, getRmdFactor } from "@/lib/config/rmd-tables";

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

  it("returns a distribution period for age 72", () => {
    const factor = getRmdFactor(72);
    expect(factor).not.toBeNull();
    expect(factor!).toBeGreaterThan(0);
  });

  it("returns decreasing factors as age increases", () => {
    const factor80 = getRmdFactor(80)!;
    const factor90 = getRmdFactor(90)!;
    expect(factor80).toBeGreaterThan(factor90);
  });

  it("handles ages above 120 by returning the age-120 factor", () => {
    const factor120 = getRmdFactor(120);
    const factor125 = getRmdFactor(125);
    expect(factor120).not.toBeNull();
    expect(factor125).toEqual(factor120);
  });
});
