/**
 * Years a paycheck is gone before the plan retires: the budget's shortfall
 * comes out of the accounts. Fictional households; see gap-year-draw.ts.
 */
import { assert, describe, expect, it } from "vitest";
import { calculateProjection, gapUnmetNeedMaterial } from "@/lib/pure/engine";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import {
  toSimpleTaxMode,
  type SimpleTaxModeParts,
} from "@/lib/pure/tax/simple-tax-mode";
import { acct, household } from "../fixtures/two-person-household";
import {
  annRoth,
  boMatch,
  boSavingSpecs,
  couple,
  payrollTax,
  people,
  portfolioRoth,
  portfolioSavingSpecs,
  returnRates,
  stoppedZeroRateCouple,
} from "../fixtures/gap-year-couple";

const year = (i: ProjectionInput, y: number) => {
  const row = calculateProjection(i).projectionByYear.find(
    (r) => r.year === y,
  )!;
  assert(row.phase === "accumulation");
  return row;
};

describe("a gap year's material unmet need", () => {
  // SHORTFALL_MATERIALITY: $50, or 1% of the need when that is more.
  it.each([
    [1000, 49.99, false],
    [1000, 50, true],
    [60000, 599.99, false],
    [60000, 600, true],
  ])("need %s with %s unmet: %s", (need, unmetNeed, material) => {
    expect(gapUnmetNeedMaterial({ need, unmetNeed })).toBe(material);
  });
});

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
      socialSecurityEntries: undefined,
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
    const contributionSpecs = boSavingSpecs;
    const employerMatchRateByCategory = boMatch;
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
  // Stopping saving takes precedence over the 0% row. Pins today's figures,
  // so the 0% ceiling can't reach a stopped year's specs.
  const run = () => year(stoppedZeroRateCouple(), 2031);

  it("saves nothing, gets no match, and no rate ceiling scales the year", () => {
    const stopped = run();
    expect(stopped.savingStopped).toBe(true);
    expect(stopped.totalEmployee).toBe(0);
    expect(stopped.totalEmployer).toBe(0);
    expect(stopped.rateCeilingScale).toBeNull();
    // The draw covers the budget with nothing taken out for saving.
    expect(stopped.gapDraw!.contributions).toBe(0);
    expect(stopped.gapDraw!.need).toBe(56590);
    expect(stopped.gapDraw!.withdrawal).toBe(56590);
    expect(stopped.retirementBalance).toBe(1042073.51);
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
      acct("Ann IRA", "ira", 600000, 1),
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
    // Grossed up, the draw nets exactly the 56,590 need: 70,737.50 less its
    // tax of 14,147.50, nothing unmet.
    expect(figures(input)).toEqual({
      contributions: 0,
      need: 56590,
      pay: 60000,
      slots: [["ira", 70737.5, 0, 70737.5]],
      spending: 100000,
      spendingCut: 0,
      ssIncome: 0,
      taxCost: 14147.5,
      taxOnIncome: 16590,
      unmetNeed: 0,
      warnings: [],
      withdrawal: 70737.5,
    });
  });
});

// A gap year's draw covers spending only: its Portfolio saving is funded
// from the pay left after spending; only the part a draw would have to
// fund is skipped, with a warning. Worked by hand from the rule: in 2031
// Bo's $60,000 pay carries $16,590 of tax and payroll tax (the year's own
// figure, pinned above), so $43,410 is left before spending. Bo saves
// $6,000 a year to a Portfolio-parented Roth IRA (after tax, so the saving
// doesn't change the year's tax).
describe("a gap year's Portfolio saving", () => {
  const contributionSpecs = portfolioSavingSpecs;
  const run = (annualExpenses: number) => {
    const row = year(
      couple({ contributionSpecs, annualExpenses }, [
        annRoth(),
        acct("Bo Brokerage", "brokerage", 400000, 2, "afterTax"),
        portfolioRoth,
      ]),
      2031,
    );
    const saved = row.individualAccountBalances.find(
      (a) => a.name === "Bo Portfolio Roth",
    )?.contribution;
    const skipWarning = row.warnings.find((w) =>
      w.includes("Portfolio saving"),
    );
    return { row, saved, skipWarning };
  };

  it("pay that covers the saving: all of it saved, nothing drawn", () => {
    // $43,410 − $30,000 spending = $13,410 left, over the $6,000.
    const { row, saved, skipWarning } = run(30000);
    expect(row.gapDraw?.taxOnIncome).toBe(16590);
    expect(saved).toBe(6000);
    expect(row.totalEmployee).toBe(6000);
    expect(row.gapDraw?.withdrawal).toBe(0);
    expect(skipWarning).toBeUndefined();
  });

  it("pay that covers part: that part saved, the rest skipped and warned", () => {
    // $43,410 − $40,000 = $3,410 saved; $2,590 skipped, not drawn.
    const { row, saved, skipWarning } = run(40000);
    expect(row.gapDraw?.taxOnIncome).toBe(16590);
    expect(saved).toBe(3410);
    expect(row.totalEmployee).toBe(3410);
    expect(row.gapDraw?.need).toBe(0);
    expect(row.gapDraw?.withdrawal).toBe(0);
    expect(skipWarning).toBe(
      "2031: $2,590 of Portfolio saving skipped: the pay left after spending doesn't cover it, and a gap year draws for spending only.",
    );
  });

  it("pay that covers none of it: all skipped and warned, the draw is spending only", () => {
    // $43,410 − $100,000 = −$56,590: nothing saved; the draw is the
    // $56,590 spending needs; the $6,000 isn't drawn.
    const { row, saved, skipWarning } = run(100000);
    expect(saved ?? 0).toBe(0);
    expect(row.totalEmployee).toBe(0);
    expect(row.gapDraw?.need).toBe(56590);
    expect(row.gapDraw?.contributions).toBe(0);
    expect(skipWarning).toContain("2031: $6,000 of Portfolio saving skipped");
  });

  it("a working year saves it all", () => {
    expect(year(couple({ contributionSpecs }), 2029).totalEmployee).toBe(6000);
  });
});

// The brokerage ramp ($1,000 more each year, so $5,000 in 2031) is Portfolio
// saving only when it lands in a Portfolio brokerage; with none it goes to a
// Retirement brokerage, and retirement saving continues as configured.
describe("a gap year's brokerage ramp", () => {
  const ramp = { brokerageContributionRamp: 1000 };

  it("with no Portfolio brokerage it is retirement saving: kept and drawn for", () => {
    // $100,000 − ($60,000 − $5,000 − $16,590) = $61,590.
    const row = year(couple(ramp), 2031);
    expect(row.brokerageRampContribution).toBe(5000);
    expect(row.gapDraw?.need).toBe(61590);
    expect(row.warnings.some((w) => w.includes("Portfolio saving"))).toBe(
      false,
    );
  });

  it("with no Portfolio brokerage Simple mode keeps it too", () => {
    const zero = { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 };
    const parts: SimpleTaxModeParts = {
      retirementBuckets: {
        preTax: 0,
        taxFree: 400000,
        hsa: 0,
        afterTax: 400000,
        afterTaxBasis: 400000,
      },
      defaults: {
        baseYearContributions: zero,
        baseYearEmployerMatch: zero,
        employerMatchRateByCategory: zero,
        accountSplits: zero,
        taxSplits: {},
      },
    };
    const row = year(toSimpleTaxMode(couple(ramp), parts), 2031);
    expect(row.brokerageRampContribution).toBe(5000);
    expect(row.warnings.some((w) => w.includes("Portfolio saving"))).toBe(
      false,
    );
  });

  it("landing in a Portfolio brokerage it is Portfolio saving: skipped and warned", () => {
    const row = year(
      couple(ramp, [
        annRoth(),
        acct("Bo Brokerage", "brokerage", 400000, 2, "afterTax"),
        {
          ...acct("Bo Portfolio", "brokerage", 20000, 2, "afterTax"),
          parentCategory: "Portfolio",
        },
      ]),
      2031,
    );
    expect(row.brokerageRampContribution).toBe(0);
    expect(row.gapDraw?.need).toBe(56590);
    expect(row.warnings).toContain(
      "2031: $5,000 of Portfolio saving skipped: the pay left after spending doesn't cover it, and a gap year draws for spending only.",
    );
  });
});
