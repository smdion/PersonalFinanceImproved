import { describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import { expenseEndingFactor } from "@/lib/calculators/engine/expense-endings";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { acct, household } from "./fixtures/two-person-household";

const returnRates = Array.from({ length: 70 }, (_, i) => ({
  label: `Age ${30 + i}`,
  rate: 0.05,
}));
const base = (overrides: Partial<ProjectionInput> = {}) =>
  household([acct("Ann IRA", "ira", 2000000, 1)], {
    asOfDate: new Date("2026-01-01"),
    currentAge: 50,
    birthYear: 1976,
    perPersonBirthYears: [1976],
    retirementYear: 2036,
    projectionEndYear: 2050,
    currentSalary: 150000,
    salaryGrowthRate: 0,
    annualExpenses: 100000,
    inflationRate: 0,
    returnRates,
    ...overrides,
  });
const spend = (i: ProjectionInput, y: number) =>
  calculateProjection(i).projectionByYear.find((r) => r.year === y)!
    .projectedExpenses;

describe("expenseEndingFactor", () => {
  const endings = [{ year: 2030, accumulation: 0.2, decumulation: 0.25 }];
  it("is the share left in the year it ends, and 1 otherwise", () => {
    const at = (year: number, phase: "accumulation" | "decumulation") =>
      expenseEndingFactor({ endings, phase, year, seeded: false });
    expect(at(2029, "accumulation")).toBe(1);
    expect(at(2030, "accumulation")).toBeCloseTo(0.8);
    expect(at(2031, "accumulation")).toBe(1);
  });
  it("takes everything already ended off a freshly seeded budget", () => {
    expect(
      expenseEndingFactor({
        endings,
        phase: "decumulation",
        year: 2036,
        seeded: true,
      }),
    ).toBeCloseTo(0.75);
  });
  it("two loans end separately", () => {
    const two = [
      ...endings,
      { year: 2032, accumulation: 0.2, decumulation: 0 },
    ];
    expect(
      expenseEndingFactor({
        endings: two,
        phase: "accumulation",
        year: 2032,
        seeded: false,
      }),
    ).toBeCloseTo(0.75);
  });
  it("no endings changes nothing", () => {
    expect(
      expenseEndingFactor({
        endings: undefined,
        phase: "accumulation",
        year: 2030,
        seeded: false,
      }),
    ).toBe(1);
  });
});

describe("a loan paid off in the projection", () => {
  const ending = { year: 2030, accumulation: 0.2, decumulation: 0.2 };

  it("before retirement: spending drops, and stays dropped in retirement", () => {
    const i = base({ expenseEndings: [ending] });
    expect(spend(i, 2029)).toBeCloseTo(100000, 0);
    expect(spend(i, 2030)).toBeCloseTo(80000, 0);
    expect(spend(i, 2040)).toBeCloseTo(80000, 0);
  });

  it("before retirement, with a separate retirement budget: taken at its seed", () => {
    const i = base({
      decumulationAnnualExpenses: 120000,
      expenseEndings: [ending],
    });
    expect(spend(i, 2036)).toBeCloseTo(96000, 0);
  });

  it("at the retirement year itself", () => {
    const i = base({
      decumulationAnnualExpenses: 120000,
      expenseEndings: [{ ...ending, year: 2036 }],
    });
    expect(spend(i, 2036)).toBeCloseTo(96000, 0);
  });

  it("after retirement: retirement spending drops that year", () => {
    const i = base({ expenseEndings: [{ ...ending, year: 2040 }] });
    expect(spend(i, 2039)).toBeCloseTo(100000, 0);
    expect(spend(i, 2040)).toBeCloseTo(80000, 0);
  });

  it("raises what the plan keeps in retirement", () => {
    const with_ = calculateProjection(base({ expenseEndings: [ending] }));
    const without = calculateProjection(base());
    expect(with_.projectionByYear.at(-1)!.retirementBalance).toBeGreaterThan(
      without.projectionByYear.at(-1)!.retirementBalance,
    );
  });

  it("a figure typed in for a year stays as typed", () => {
    const i = base({
      budgetOverrides: [{ year: 2029, value: 10000 }],
      expenseEndings: [ending],
    });
    expect(spend(i, 2030)).toBeCloseTo(120000, 0);
  });

  it("a figure typed before retirement and carried into it stays too", () => {
    const i = base({
      budgetOverrides: [{ year: 2029, value: 10000 }],
      expenseEndings: [{ ...ending, year: 2040 }],
    });
    expect(spend(i, 2041)).toBeCloseTo(120000, 0);
  });

  it("the stated retirement need takes the same cut (Coast FIRE reads it)", () => {
    const r = calculateProjection(
      base({ decumulationAnnualExpenses: 120000, expenseEndings: [ending] }),
    );
    expect(r.firstDecumulationYearStatedNeed).toBeCloseTo(96000, 0);
  });

  it("a rate-seeded retirement ignores later endings too", () => {
    const seeded = { rateSeededDecumulationYear1: true };
    expect(
      spend(
        base({ ...seeded, expenseEndings: [{ ...ending, year: 2040 }] }),
        2041,
      ),
    ).toBeCloseTo(spend(base(seeded), 2041), 0);
  });

  it("a rate-seeded retirement has no budget to take it from", () => {
    const seeded = { rateSeededDecumulationYear1: true };
    const y = (i: ProjectionInput) => spend(i, 2036);
    expect(
      y(base({ ...seeded, expenseEndings: [{ ...ending, year: 2036 }] })),
    ).toBeCloseTo(y(base(seeded)), 0);
  });
});
