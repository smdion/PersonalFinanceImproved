import { describe, it, expect } from "vitest";
import {
  UNIFORM_LIFETIME_TABLE,
  getRmdStartAge,
  getRmdFactor,
  computeRmdAmount,
  soleBeneficiarySpouseAges,
} from "@/lib/config/rmd-tables";
import { jointLifeDivisor } from "@/lib/config/rmd-joint-life-table";
import { UNIFORM_LIFETIME_PUBLISHED as PUBLISHED } from "../fixtures/irs-published/rmd-uniform-lifetime";
import { JOINT_LIFE_PUBLISHED } from "../fixtures/irs-published/rmd-joint-life";

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

describe("getRmdFactor — Joint and Last Survivor Table (sole-beneficiary spouse)", () => {
  // Every cell of rows 72-120 against the regulation, keyed separately.
  it(`jointLifeDivisor is ${JOINT_LIFE_PUBLISHED.cite}: every cell a spouse over 10 years younger reaches, owner ages 72-120 [RET-02]`, () => {
    const rows = Object.entries(JOINT_LIFE_PUBLISHED.value);
    expect(rows).toHaveLength(49);
    let cells = 0;
    for (const [age, row] of rows) {
      const owner = Number(age);
      expect(row).toHaveLength(121);
      // The 120 row ("120 and over") holds every spouse age; the others to owner − 11.
      const last = owner === 120 ? 120 : owner - 11;
      for (let spouse = 0; spouse <= last; spouse++, cells++)
        expect(jointLifeDivisor(owner, spouse), `${owner}/${spouse}`).toBe(
          row[spouse],
        );
      expect(jointLifeDivisor(owner, last + 1)).toBeUndefined();
    }
    expect(cells).toBe(4225);
    expect(jointLifeDivisor(71, 40)).toBeUndefined();
    expect(jointLifeDivisor(80, 2.5)).toBeUndefined();
    expect(jointLifeDivisor(80, -1)).toBeUndefined();
  });

  it("Table II at exactly 10 years younger is Table III, at every age 72-120 (Reg. -9(c) is built that way)", () => {
    for (const [age, divisor] of Object.entries(PUBLISHED.value))
      expect(JOINT_LIFE_PUBLISHED.value[Number(age)]![Number(age) - 10]).toBe(
        divisor,
      );
  });

  it("reads Table II only when the spouse is more than 10 years younger", () => {
    const at = (owner: number, spouse: number) =>
      JOINT_LIFE_PUBLISHED.value[owner]![spouse];
    expect(getRmdFactor(75, 64)).toBe(at(75, 64));
    expect(getRmdFactor(75, 65)).toBe(PUBLISHED.value[75]);
    expect(getRmdFactor(75, 80)).toBe(PUBLISHED.value[75]);
    expect(getRmdFactor(75, null)).toBe(PUBLISHED.value[75]);
    expect(getRmdFactor(75, undefined)).toBe(PUBLISHED.value[75]);
  });

  it("is null below the owner's table, whatever the spouse's age", () => {
    expect(getRmdFactor(71, 40)).toBeNull();
    expect(computeRmdAmount(100000, 71, 40)).toBeNull();
  });

  it('reads the "120 and over" row and column above 120', () => {
    const over = JOINT_LIFE_PUBLISHED.value[120]!;
    expect(getRmdFactor(125, 100)).toBe(over[100]);
    expect(getRmdFactor(140, 125)).toBe(over[120]);
  });

  it("a spouse age below 0 (not yet born) is no spouse: Table III", () => {
    expect(getRmdFactor(80, -1)).toBe(PUBLISHED.value[80]);
  });

  it("divides by the Table II divisor, rounded to cents", () => {
    // 100,000 / 25.3 = 3,952.5691 -> 3,952.57 (Pub 590-B p.8: 75 and 64).
    expect(computeRmdAmount(100000, 75, 64)).toBe(3952.57);
  });
});

describe("soleBeneficiarySpouseAges — the spouse taken as sole beneficiary", () => {
  const couple = new Map([
    [1, { birthYear: 1946 }],
    [2, { birthYear: 1957 }],
  ]);

  it("on a joint return of two, each person's spouse's age this year", () => {
    expect([...soleBeneficiarySpouseAges("MFJ", couple, 2026)]).toEqual([
      [1, 69],
      [2, 80],
    ]);
  });

  it("none on a one-person return, with no status, or with one person", () => {
    expect(soleBeneficiarySpouseAges("Single", couple, 2026).size).toBe(0);
    expect(soleBeneficiarySpouseAges("HOH", couple, 2026).size).toBe(0);
    expect(soleBeneficiarySpouseAges(undefined, couple, 2026).size).toBe(0);
    const one = new Map([[1, { birthYear: 1946 }]]);
    expect(soleBeneficiarySpouseAges("MFJ", one, 2026).size).toBe(0);
  });
});
