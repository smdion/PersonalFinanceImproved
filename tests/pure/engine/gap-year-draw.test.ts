/**
 * Years a paycheck is gone before the plan retires: the budget's shortfall
 * comes out of the accounts. Fictional households; see gap-year-draw.ts.
 */
import { assert, describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { acct, household } from "../fixtures/two-person-household";

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
    decumulationAnnualExpenses: 100000,
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
    const covered = couple({
      annualExpenses: 40000,
      decumulationAnnualExpenses: 40000,
    });
    expect(year(covered, 2031).gapDraw?.withdrawal).toBe(0);
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
      decumulationAnnualExpenses: 60000,
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

describe("the household's choices for these years", () => {
  it("stop saving: no contributions, so less to draw", () => {
    const contributionSpecs = [
      {
        category: "401k",
        name: "Bo",
        method: "percent_of_salary",
        value: 0.1,
        salaryFraction: 0.4,
        baseAnnual: 6000,
        personId: 2,
        employerShare: 1,
        personPayShare: 1,
      },
    ] as ProjectionInput["contributionSpecs"];
    const employerMatchRateByCategory = {
      "401k": 0.04,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    };
    const saving = year(
      couple({ contributionSpecs, employerMatchRateByCategory }),
      2031,
    );
    const stopped = year(
      couple({
        contributionSpecs,
        employerMatchRateByCategory,
        gapYearStopSaving: true,
      }),
      2031,
    );
    expect(saving.totalEmployer).toBeGreaterThan(0);
    expect(saving.totalEmployee).toBeGreaterThan(0);
    expect(stopped.totalEmployee).toBe(0);
    expect(stopped.totalEmployer).toBe(0);
    expect(stopped.savingStopped).toBe(true);
    expect(stopped.gapDraw!.need).toBeLessThan(saving.gapDraw!.need);
    const before = year(
      couple({ contributionSpecs, gapYearStopSaving: true }),
      2029,
    );
    expect(before.totalEmployee).toBeGreaterThan(0);
  });

  it("don't draw: balances untouched, spending cut, and the plan doesn't fail", () => {
    const input = couple({ gapYearDraws: false });
    const { gapDraw } = year(input, 2031);
    assert(gapDraw);
    expect(gapDraw.withdrawal).toBe(0);
    expect(gapDraw.spendingCut).toBeGreaterThan(0);
    expect(gapDraw.unmetNeed).toBe(0);
    expect(assessPlan(calculateProjection(input)).succeeded).toBe(true);
    expect(year(input, 2034).retirementBalance).toBeGreaterThan(
      year(couple(), 2034).retirementBalance,
    );
  });

  it("stop saving with no contribution specs: nothing saved, no match", () => {
    const match = {
      "401k": 0.04,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    };
    const run = (stop: boolean) => {
      const base = couple({ employerMatchRateByCategory: match });
      return year(
        {
          ...base,
          gapYearStopSaving: stop,
          accumulationDefaults: {
            ...base.accumulationDefaults,
            contributionRate: 0.1,
          },
        },
        2031,
      );
    };
    expect(run(false).totalEmployer).toBeGreaterThan(0);
    const stopped = run(true);
    expect(stopped.totalEmployee).toBe(0);
    expect(stopped.totalEmployer).toBe(0);
  });
});

describe("a stopped year that is also a 0% year", () => {
  // Bo still has pay in 2031 and the plan's own rate is 10%, so the 0% row
  // alone would be a pause; stopping saving takes precedence. Pins today's
  // figures, so the 0% ceiling can't reach a stopped year's specs.
  const contributionSpecs = [
    {
      category: "401k",
      name: "Bo 401k",
      method: "percent_of_salary",
      value: 0.1,
      salaryFraction: 0.4,
      baseAnnual: 6000,
      personId: 2,
      employerShare: 1,
      personPayShare: 1,
    },
    {
      category: "ira",
      name: "Bo IRA",
      method: "fixed_monthly",
      value: 500,
      salaryFraction: 0.4,
      baseAnnual: 6000,
      personId: 2,
      personPayShare: 1,
    },
  ] as ProjectionInput["contributionSpecs"];
  const run = () => {
    const base = couple({
      contributionSpecs,
      gapYearStopSaving: true,
      employerMatchRateByCategory: {
        "401k": 0.04,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
    });
    return year(
      {
        ...base,
        accumulationDefaults: {
          ...base.accumulationDefaults,
          contributionRate: 0.1,
        },
        accumulationOverrides: [{ year: 2031, contributionRate: 0 }],
      },
      2031,
    );
  };

  it("saves nothing, gets no match, and no rate ceiling scales the year", () => {
    const stopped = run();
    expect(stopped.savingStopped).toBe(true);
    expect(stopped.totalEmployee).toBe(0);
    expect(stopped.totalEmployer).toBe(0);
    expect(stopped.rateCeilingScale).toBeNull();
    // The draw covers the budget with nothing taken out for saving.
    expect(stopped.gapDraw!.contributions).toBe(0);
    expect(stopped.gapDraw!.need).toBe(56590);
    expect(stopped.gapDraw!.withdrawal).toBe(59245.93);
    expect(stopped.retirementBalance).toBe(1023811.95);
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
    const withLines = couple({ budgetContributionLines: 10000 });
    expect(needIn(couple()) - needIn(withLines)).toBeCloseTo(10000, -1);
  });

  it("a loan ending doesn't shrink the contribution lines", () => {
    const input = (lines: number) =>
      couple({
        budgetContributionLines: lines,
        expenseEndings: [{ year: 2028, accumulation: 0.2, decumulation: 0 }],
      });
    expect(needIn(input(0)) - needIn(input(10000))).toBeCloseTo(10000, -1);
  });

  it("a typed year's figure stays as typed", () => {
    const typed = (lines: number) =>
      couple({
        budgetOverrides: [{ year: 2030, value: 9000 }],
        budgetContributionLines: lines,
      });
    expect(needIn(typed(10000))).toBe(needIn(typed(0)));
  });

  it("Social Security payroll tax stops at the wage base", () => {
    const high = { 1: 100000, 2: 400000 };
    const input = (base: number) =>
      couple({
        salaryByPerson: high,
        currentSalary: 500000,
        annualExpenses: 400000,
        decumulationAnnualExpenses: 400000,
        payrollTax: { ...payrollTax, socialSecurityWageBase: base },
      });
    expect(needIn(input(180000))).toBeLessThan(needIn(input(400000)));
  });

  it("the draw comes out before the year's growth", () => {
    const drawn = year(couple(), 2031);
    const kept = year(
      couple({ annualExpenses: 40000, decumulationAnnualExpenses: 40000 }),
      2031,
    );
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

// Direct pins (behavior baseline, v0.10.0): the gap year's tax figures and
// draw, as runGapYearDraw writes them on the year row. The tests above
// check relations; these PIN CURRENT BEHAVIOR to the cent, so a reshape of
// gap-year-draw.ts can't move a figure unseen. Not checked answers.
describe("gap-year figures (pins current behavior)", () => {
  const figures = (input: ProjectionInput, y = 2031) => {
    const d = year(input, y).gapDraw;
    assert(d);
    const { slots, warnings, ...numbers } = d;
    return {
      ...numbers,
      slots: slots
        .filter((s) => s.withdrawal !== 0)
        .map((s) => [
          s.category,
          s.traditionalWithdrawal,
          s.rothWithdrawal,
          s.withdrawal,
        ]),
      warnings,
    };
  };

  it("Ann retired, Bo working: drawn from Ann's Roth IRA", () => {
    expect(figures(couple())).toEqual({
      contributions: 0,
      need: 56590,
      pay: 60000,
      slots: [["ira", 0, 56590, 56590]],
      spending: 100000,
      spendingCut: 0,
      ssIncome: 0,
      taxCost: 0,
      taxOnIncome: 16590,
      unmetNeed: 0,
      warnings: [],
      withdrawal: 56590,
    });
  });

  it("with Ann's Social Security paid", () => {
    const paid = people.map((p) =>
      p.personId === 1 ? { ...p, annualAmount: 24000, startAge: 50 } : p,
    );
    expect(figures(couple({ socialSecurityEntries: paid }))).toEqual({
      contributions: 0,
      need: 36670,
      pay: 60000,
      slots: [["ira", 0, 36670, 36670]],
      spending: 100000,
      spendingCut: 0,
      ssIncome: 24000,
      taxCost: 0,
      taxOnIncome: 20670,
      unmetNeed: 0,
      warnings: [],
      withdrawal: 36670,
    });
  });

  it("Traditional money past 59½: ordinary tax on the draw on top of Bo's pay", () => {
    const accounts = [
      { ...acct("Ann IRA", "ira", 600000, 1), ownerBirthYear: 1966 },
      acct("Bo Brokerage", "brokerage", 100000, 2, "afterTax"),
    ];
    const input = couple(
      {
        birthYear: 1966,
        currentAge: 60,
        perPersonBirthYears: [1966, 1966],
        socialSecurityEntries: people.map((p) => ({ ...p, birthYear: 1966 })),
      },
      accounts,
    );
    // Grossed up, the draw nets 56,499.46 against a 56,590 need: 90.54
    // short, under the funded floor (shortfallFloor), so pinned as is.
    expect(figures(input)).toEqual({
      contributions: 0,
      need: 56590,
      pay: 60000,
      slots: [["ira", 70624.32, 0, 70624.32]],
      spending: 100000,
      spendingCut: 0,
      ssIncome: 0,
      taxCost: 14124.86,
      taxOnIncome: 16590,
      unmetNeed: 90.54,
      warnings: [],
      withdrawal: 70624.32,
    });
  });
});
