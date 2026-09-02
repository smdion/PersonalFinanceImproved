/**
 * OBBBA temporary senior deduction (One Big Beautiful Bill Act, 2025) —
 * $6,000/person 65+, tax years 2025-2028 only, phased out 6% of MAGI above
 * $150k MFJ / $75k Single/HoH/MFS. Verified against IRS guidance + Tax
 * Foundation/Kiplinger reporting, 2026-09-02 (fully phased out at $250k MFJ
 * for one qualifying senior: 150000 + 6000/0.06 = 250000, matching the
 * commonly-cited figure).
 */
import { describe, it, expect } from "vitest";
import { computeObbbaSeniorDeduction } from "@/lib/calculators/engine/obbba-senior-deduction";

const BASE = {
  perPerson: 6000,
  phaseoutStart: 150000,
  phaseoutRate: 0.06,
  sunsetYear: 2028,
};

describe("computeObbbaSeniorDeduction", () => {
  it("returns the full per-person amount when MAGI is under the phaseout start", () => {
    expect(
      computeObbbaSeniorDeduction({
        ...BASE,
        seniorCount: 1,
        magi: 100000,
        year: 2026,
      }),
    ).toBe(6000);
  });

  it("scales linearly with seniorCount when under the phaseout start", () => {
    expect(
      computeObbbaSeniorDeduction({
        ...BASE,
        seniorCount: 2,
        magi: 100000,
        year: 2026,
      }),
    ).toBe(12000);
  });

  it("reduces by 6% of MAGI over the threshold", () => {
    // $50,000 over threshold * 6% = $3,000 reduction
    expect(
      computeObbbaSeniorDeduction({
        ...BASE,
        seniorCount: 1,
        magi: 200000,
        year: 2026,
      }),
    ).toBe(3000);
  });

  it("fully phases out at exactly $250,000 MAGI for one qualifying senior (MFJ)", () => {
    expect(
      computeObbbaSeniorDeduction({
        ...BASE,
        seniorCount: 1,
        magi: 250000,
        year: 2026,
      }),
    ).toBe(0);
  });

  it("never goes negative once MAGI exceeds the full-phaseout point", () => {
    expect(
      computeObbbaSeniorDeduction({
        ...BASE,
        seniorCount: 1,
        magi: 1000000,
        year: 2026,
      }),
    ).toBe(0);
  });

  it("two seniors' combined base phases out further out than one senior's", () => {
    // $12,000 base / 6% = $200,000 of room -> fully phased out at $350,000
    expect(
      computeObbbaSeniorDeduction({
        ...BASE,
        seniorCount: 2,
        magi: 300000,
        year: 2026,
      }),
    ).toBeGreaterThan(0);
    expect(
      computeObbbaSeniorDeduction({
        ...BASE,
        seniorCount: 2,
        magi: 350000,
        year: 2026,
      }),
    ).toBe(0);
  });

  it("is $0 for a year after the sunset year", () => {
    expect(
      computeObbbaSeniorDeduction({
        ...BASE,
        seniorCount: 1,
        magi: 100000,
        year: 2029,
      }),
    ).toBe(0);
  });

  it("still applies in the last authorized year (sunsetYear itself)", () => {
    expect(
      computeObbbaSeniorDeduction({
        ...BASE,
        seniorCount: 1,
        magi: 100000,
        year: 2028,
      }),
    ).toBe(6000);
  });

  it("is $0 with no seniors", () => {
    expect(
      computeObbbaSeniorDeduction({
        ...BASE,
        seniorCount: 0,
        magi: 100000,
        year: 2026,
      }),
    ).toBe(0);
  });

  it("is $0 when MAGI is undefined (no prior-year MAGI — decumulation year 1)", () => {
    expect(
      computeObbbaSeniorDeduction({
        ...BASE,
        seniorCount: 1,
        magi: undefined,
        year: 2026,
      }),
    ).toBe(0);
  });

  it("is $0 when any config figure is undefined (not seeded)", () => {
    expect(
      computeObbbaSeniorDeduction({
        seniorCount: 1,
        magi: 100000,
        perPerson: undefined,
        phaseoutStart: 150000,
        phaseoutRate: 0.06,
        sunsetYear: 2028,
        year: 2026,
      }),
    ).toBe(0);
    expect(
      computeObbbaSeniorDeduction({
        seniorCount: 1,
        magi: 100000,
        perPerson: 6000,
        phaseoutStart: 150000,
        phaseoutRate: 0.06,
        sunsetYear: undefined,
        year: 2026,
      }),
    ).toBe(0);
  });
});
