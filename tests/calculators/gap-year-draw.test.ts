/**
 * Years a paycheck is gone before the plan retires: the budget's shortfall
 * comes out of the accounts. Fictional households; see gap-year-draw.ts.
 */
import { assert, describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import { assessPlan } from "@/lib/calculators/plan-outcome";
import type { ProjectionInput } from "@/lib/calculators/types";
import { acct, household } from "./fixtures/two-person-household";

const returnRates = Array.from({ length: 70 }, (_, i) => ({
  label: `Age ${30 + i}`,
  rate: 0.05,
}));
const payrollTax = {
  socialSecurityRate: 0.062,
  medicareRate: 0.0145,
  socialSecurityWageBase: 180000,
};
const people = [1, 2].map((personId) => ({
  personId,
  personName: personId === 1 ? "Ann" : "Bo",
  birthYear: 1976,
  startAge: 70,
  annualAmount: 0,
}));

/** Both 50 in 2026. Ann retires in 2030, Bo works to 2035. */
function couple(
  overrides: Partial<ProjectionInput> = {},
  accounts = [
    acct("Ann Roth IRA", "ira", 400000, 1, "taxFree"),
    acct("Bo Brokerage", "brokerage", 400000, 2, "afterTax"),
  ],
): ProjectionInput {
  return household(accounts, {
    asOfDate: new Date("2026-01-01"),
    currentAge: 50,
    birthYear: 1976,
    perPersonBirthYears: [1976, 1976],
    socialSecurityEntries: people,
    retirementYear: 2035,
    retirementYearByPerson: { 1: 2030, 2: 2035 },
    projectionEndYear: 2045,
    salaryByPerson: { 1: 100000, 2: 60000 },
    currentSalary: 160000,
    salaryGrowthRate: 0,
    annualExpenses: 100000,
    inflationRate: 0,
    returnRates,
    payrollTax,
    ...overrides,
  });
}

const year = (i: ProjectionInput, y: number) => {
  const row = calculateProjection(i).projectionByYear.find(
    (r) => r.year === y,
  )!;
  assert(row.phase === "accumulation");
  return row;
};

describe("gap-year draw", () => {
  it("draws nothing while both work", () => {
    expect(year(couple(), 2029).gapDraw).toBeUndefined();
  });

  it("draws what the remaining pay doesn't cover, with tax on top", () => {
    const { gapDraw } = year(couple(), 2031);
    assert(gapDraw);
    // $60k gross leaves well under the $100k budget.
    expect(gapDraw.need).toBeGreaterThan(40000);
    expect(gapDraw.need).toBeLessThan(60000);
    expect(gapDraw.withdrawal).toBeCloseTo(gapDraw.need + gapDraw.taxCost, -1);
    expect(gapDraw.unmetNeed).toBeLessThan(5);
  });

  it("the balance falls by the draw against the same plan with enough pay", () => {
    const covered = couple({ annualExpenses: 40000 });
    expect(year(covered, 2031).gapDraw).toBeUndefined();
    expect(year(couple(), 2034).retirementBalance).toBeLessThan(
      year(covered, 2034).retirementBalance,
    );
  });

  it("a job ending before its holder retires is a gap too", () => {
    const single = household([acct("Ann IRA", "ira", 900000, 1)], {
      asOfDate: new Date("2026-01-01"),
      currentAge: 62,
      birthYear: 1964,
      perPersonBirthYears: [1964],
      retirementYear: 2036,
      projectionEndYear: 2045,
      currentSalary: 80000,
      salaryGrowthRate: 0,
      annualExpenses: 60000,
      inflationRate: 0,
      returnRates,
      workingYearsByPerson: { 1: { start: null, end: 2028 } },
    });
    expect(year(single, 2028).gapDraw).toBeUndefined();
    expect(year(single, 2030).gapDraw?.need).toBeCloseTo(60000, -2);
  });

  it("a job that hasn't started changes nothing", () => {
    const input = couple({
      retirementYearByPerson: undefined,
      workingYearsByPerson: { 2: { start: 2032, end: null } },
    });
    expect(year(input, 2030).gapDraw).toBeUndefined();
  });

  it("money locked until 59½ is left alone: an unmet need, not a penalty", () => {
    const input = couple({}, [
      {
        ...acct("Ann Roth 401k", "401k", 800000, 1, "taxFree"),
        ownerBirthYear: 1976,
        ruleOf55: {
          eligible: false,
          separationYear: null,
          source: "active" as const,
          knownFutureSeparationYear: 2030,
        },
      },
    ]);
    const { gapDraw } = year(input, 2031);
    assert(gapDraw);
    // Ann separated at 54: under the Rule of 55 age nothing is reachable,
    // so the year is unfunded, not quietly drawn at a penalty.
    expect(gapDraw.withdrawal).toBe(0);
    expect(gapDraw.unmetNeed).toBeGreaterThan(0);
  });

  it("money out of reach fails the plan rather than passing silently", () => {
    const broke = couple({}, [acct("Ann 401k", "401k", 100, 1)]);
    const outcome = assessPlan(calculateProjection(broke));
    expect(outcome.succeeded).toBe(false);
    expect(outcome.failureYear).toBe(2030);
    expect(outcome.failureReason).toBe("shortfall");
  });
});

describe("what goes into a gap year's shortfall", () => {
  const needIn = (i: ProjectionInput) => year(i, 2031).gapDraw?.need ?? 0;

  it("a retired spouse's Social Security comes off it", () => {
    const paid = people.map((p) =>
      p.personId === 1 ? { ...p, annualAmount: 24000, startAge: 50 } : p,
    );
    expect(needIn(couple({ socialSecurityEntries: paid }))).toBeLessThan(
      needIn(couple()) - 15000,
    );
  });

  it("contribution lines in the budget aren't counted twice", () => {
    const withLines = couple({ budgetContributionShare: 0.1 });
    expect(needIn(couple()) - needIn(withLines)).toBeCloseTo(10000, -1);
  });

  it("Social Security payroll tax stops at the wage base", () => {
    const high = { 1: 100000, 2: 400000 };
    const input = (base: number) =>
      couple({
        salaryByPerson: high,
        currentSalary: 500000,
        annualExpenses: 400000,
        payrollTax: { ...payrollTax, socialSecurityWageBase: base },
      });
    expect(needIn(input(180000))).toBeLessThan(needIn(input(400000)));
  });

  it("the draw comes out before the year's growth", () => {
    const drawn = year(couple(), 2031);
    const kept = year(couple({ annualExpenses: 40000 }), 2031);
    const gap = kept.retirementBalance - drawn.retirementBalance;
    expect(gap).toBeGreaterThan(drawn.gapDraw!.withdrawal);
  });
});

describe("gap-year draw from Roth past the Rule of 55 age", () => {
  it("pays ordinary tax on the growth", () => {
    const account = {
      ...acct("Ann Roth 401k", "401k", 800000, 1, "taxFree"),
      ownerBirthYear: 1973,
      ruleOf55: {
        eligible: false,
        separationYear: null,
        source: "active" as const,
        knownFutureSeparationYear: 2030,
      },
    };
    const input = couple(
      {
        birthYear: 1973,
        currentAge: 53,
        perPersonBirthYears: [1973, 1973],
        socialSecurityEntries: people.map((p) => ({ ...p, birthYear: 1973 })),
      },
      [account],
    );
    const { gapDraw } = year(input, 2031);
    assert(gapDraw);
    expect(gapDraw.withdrawal).toBeGreaterThan(gapDraw.need);
    expect(gapDraw.taxCost).toBeGreaterThan(0);
  });
});
