import { describe, it, expect } from "vitest";
import {
  buildMilestoneInput,
  currentFooStep,
  evaluateMilestones,
  firstReachedYear,
  incomeMultipleTarget,
  inflateTarget,
  milestoneHoldings,
  milestoneLimits,
  milestoneProjectionYears,
  milestoneTimeline,
  milestoneYearFromHistory,
  nextUpMilestones,
  parseMilestoneSettings,
  projectedFiYear,
  sinceLastYear,
  type MilestoneInput,
  type MilestoneResult,
} from "@/lib/pure/milestones";
import {
  FIDELITY_CHECKPOINTS,
  MONEY_GUY_CHECKPOINTS,
} from "@/lib/config/milestones";
import { makeInput, makeProjection, makeYear } from "../fixtures/milestones";

function byId(results: MilestoneResult[], id: string): MilestoneResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`no result ${id}`);
  return r;
}
const run = (overrides: Partial<MilestoneInput> = {}) =>
  evaluateMilestones(makeInput(overrides));

describe("incomeMultipleTarget", () => {
  it("glides from 0× at 22 through Money Guy's checkpoints", () => {
    expect(incomeMultipleTarget(MONEY_GUY_CHECKPOINTS, 22)).toBe(0);
    expect(incomeMultipleTarget(MONEY_GUY_CHECKPOINTS, 26)).toBeCloseTo(0.5);
    expect(incomeMultipleTarget(MONEY_GUY_CHECKPOINTS, 30)).toBe(1);
    expect(incomeMultipleTarget(MONEY_GUY_CHECKPOINTS, 35)).toBeCloseTo(2);
    expect(incomeMultipleTarget(MONEY_GUY_CHECKPOINTS, 50)).toBeCloseTo(6.4);
    expect(incomeMultipleTarget(MONEY_GUY_CHECKPOINTS, 70)).toBe(20);
  });

  it("reads Fidelity's table the same way", () => {
    expect(incomeMultipleTarget(FIDELITY_CHECKPOINTS, 40)).toBe(3);
    expect(incomeMultipleTarget(FIDELITY_CHECKPOINTS, 63.5)).toBeCloseTo(9);
    expect(incomeMultipleTarget(FIDELITY_CHECKPOINTS, 18)).toBe(0);
  });
});

describe("projectedFiYear", () => {
  const flatGrowth = (rate: number) =>
    Array.from({ length: 30 }, (_, i) => ({
      year: 2026 + i,
      age: 40 + i,
      liquid: 1_400_000 * Math.pow(1 + rate, i),
      salary: null,
      contributions: null,
    }));

  it("finds the first future year the projection covers the FI number", () => {
    expect(projectedFiYear(flatGrowth(0.02), 1_500_000, 0, 2026)).toEqual({
      year: 2030,
      age: 44,
    });
  });

  it("grows the FI number with inflation, since the projection is nominal", () => {
    // 2% growth never catches a target growing 3% a year.
    expect(projectedFiYear(flatGrowth(0.02), 1_500_000, 0.03, 2026)).toBeNull();
  });

  it("returns null without an FI number", () => {
    expect(projectedFiYear(flatGrowth(0.05), 0, 0.03, 2026)).toBeNull();
  });
});

describe("history helpers", () => {
  it("firstReachedYear can leave out the still-accruing current year", () => {
    const years = [
      makeYear({ year: 2025, isCurrent: false, liquid: 90_000 }),
      makeYear({ year: 2026, isCurrent: true, liquid: 120_000 }),
    ];
    expect(firstReachedYear(years, (y) => y.liquid >= 100_000)).toBe(2026);
    expect(
      firstReachedYear(years, (y) => y.liquid >= 100_000, false),
    ).toBeNull();
  });

  it("inflateTarget compounds between years", () => {
    expect(inflateTarget(100, 2026, 2028, 0.1)).toBeCloseTo(121);
    expect(inflateTarget(100, 2026, 2025, 0.1)).toBeCloseTo(90.909, 2);
  });
});

describe("wealth journey", () => {
  it("dates the first $100k from history", () => {
    const r = byId(run(), "first100k");
    expect(r.status).toBe("reached");
    expect(r.reachedYear).toBe(2024);
    expect(r.note).toBe("By 2024 (first year on record)");
    expect(r.achievements).toEqual([{ year: 2024, label: "Your first $100k" }]);
  });

  it("keeps a reached date when the figure has since dipped below", () => {
    const input = makeInput();
    input.years[1] = { ...input.years[1]!, liquid: 120_000 };
    input.years[0] = { ...input.years[0]!, liquid: 80_000 };
    input.years[2] = { ...input.years[2]!, liquid: 95_000 };
    const r = byId(evaluateMilestones(input), "first100k");
    expect(r.status).toBe("reached");
    expect(r.reachedYear).toBe(2025);
    expect(r.note).toBe("Reached 2025 · currently below");
  });

  it("projects the liquid millionaire year", () => {
    const r = byId(run(), "liquidMillionaire");
    // 300k × 1.1^n ≥ 1M → n = 13
    expect(r.status).toBe("onTrack");
    expect(r.expectedYear).toBe(2039);
    expect(r.progress).toBeCloseTo(0.3);
    expect(r.nextStep).toBe("$700,000.00 to go");
  });

  it("is behind when the projection never gets there", () => {
    const r = byId(
      run({
        projection: {
          years: makeProjection(2026, 300_000, 0),
          inflationRate: 0.03,
          isScenario: false,
        },
      }),
      "liquidMillionaire",
    );
    expect(r.status).toBe("behind");
    expect(r.note).toBe("Not reached in the projection");
  });

  it("labels scenario projections", () => {
    const r = byId(
      run({
        projection: {
          years: makeProjection(2026, 300_000, 0.1),
          inflationRate: 0.03,
          isScenario: true,
        },
      }),
      "liquidMillionaire",
    );
    expect(r.note).toContain("(scenario)");
  });

  it("dates 'investments save harder' from finalized years only", () => {
    const input = makeInput({
      savings: {
        rate: 0.22,
        saved: 33_000,
        savedWithMatch: 38_000,
        compensation: 150_000,
        matchCounted: true,
      },
    });
    // 2025: 240k × 8% = 19.2k < 38k; now: 300k × 8% = 24k < 38k.
    expect(
      byId(evaluateMilestones(input), "investmentsSaveHarder").status,
    ).not.toBe("reached");
    input.years[1] = { ...input.years[1]!, liquid: 500_000 };
    const r = byId(evaluateMilestones(input), "investmentsSaveHarder");
    expect(r.status).toBe("reached");
    expect(r.reachedYear).toBe(2025);
  });

  it("projects 'money works harder' against projected pay", () => {
    const r = byId(run(), "moneyWorksHarder");
    // 300k × 1.1^n × 8% ≥ 150k → liquid ≥ 1.875M → n = 20
    expect(r.status).toBe("onTrack");
    expect(r.expectedYear).toBe(2046);
  });

  it("FI is on pace from the projection with an inflating target", () => {
    const r = byId(run(), "fi");
    expect(r.status).toBe("onTrack");
    // 300k × 1.1^n ≥ 1.5M × 1.03^n → n = 25
    expect(r.expectedYear).toBe(2051);
    expect(r.short).toBe("On pace for age 60");
  });

  it("journey milestones are unknown, not on track, without a projection", () => {
    const results = run({ projection: null });
    expect(byId(results, "liquidMillionaire").status).toBe("unknown");
    expect(byId(results, "moneyWorksHarder").status).toBe("unknown");
    // Still shows how far along it is.
    expect(byId(results, "liquidMillionaire").progress).toBeCloseTo(0.3);
    expect(nextUpMilestones(results).length).toBeGreaterThan(0);
  });

  it("FI counts as reached only while today's figure is there", () => {
    const input = makeInput();
    input.years[1] = { ...input.years[1]!, fiProgress: 1.05 };
    const dipped = byId(evaluateMilestones(input), "fi");
    expect(dipped.status).toBe("onTrack");
    expect(dipped.note).toContain("Reached 2025 · currently below");
    expect(dipped.achievements).toEqual([
      { year: 2025, label: "Financial independence" },
    ]);
    input.years[2] = { ...input.years[2]!, fiProgress: 1.02 };
    expect(byId(evaluateMilestones(input), "fi")).toMatchObject({
      status: "reached",
      reachedYear: 2025,
    });
  });

  it("FI is unknown without a projection and flagged when never reached", () => {
    expect(byId(run({ projection: null }), "fi").status).toBe("unknown");
    const never = byId(
      run({
        projection: {
          years: makeProjection(2026, 300_000, 0),
          inflationRate: 0.03,
          isScenario: false,
        },
      }),
      "fi",
    );
    expect(never.status).toBe("behind");
    expect(never.alert).toBe(true);
  });
});

describe("wealth formula", () => {
  const score = (wealthScore: number) => {
    const input = makeInput();
    input.years[2] = { ...input.years[2]!, wealthScore };
    return byId(evaluateMilestones(input), "wealthFormula");
  };

  it("uses the book's bands: UAW at ½ or less is an alert", () => {
    expect(score(0.4)).toMatchObject({ status: "behind", alert: true });
    expect(score(0.5).alert).toBe(true);
    expect(score(0.8)).toMatchObject({ status: "behind", alert: false });
    expect(score(1.5)).toMatchObject({ status: "onTrack", alert: false });
    expect(score(2.2)).toMatchObject({ status: "reached", reachedYear: 2026 });
  });

  it("says how much net worth makes PAW", () => {
    // net worth 400k at 1.25 → expected 320k → PAW at 640k
    expect(score(1.25).nextStep).toBe(
      "PAW at $640,000.00 net worth — $240,000.00 to go",
    );
  });
});

describe("income-multiple checkpoints", () => {
  it("compares liquid ÷ income with the age target and dates checkpoints", () => {
    const r = byId(run(), "moneyGuyCheckpoints");
    // 300k / 150k = 2.0 at 35, target 2.0
    expect(r.status).toBe("onTrack");
    expect(r.achievements).toEqual([{ year: 2024, label: "1.0× income" }]);
    expect(r.note).toContain("next 3.0× by 40");
    expect(r.expectedYear).toBe(2031);
  });

  it("Fidelity counts retirement accounts only", () => {
    const r = byId(run(), "fidelityCheckpoints");
    // 220k / 150k = 1.47 at 35 vs 2.0
    expect(r.status).toBe("behind");
    expect(r.achievements.map((a) => a.label)).toEqual([
      "1.0× income (Fidelity)",
    ]);
  });
});

describe("Financial Order of Operations", () => {
  it("judges each step and finds the one you're on", () => {
    const results = run();
    expect(byId(results, "foo1").status).toBe("unknown");
    expect(byId(results, "foo2").status).toBe("reached");
    expect(byId(results, "foo3").status).toBe("reached");
    expect(byId(results, "foo4").status).toBe("reached");
    expect(byId(results, "foo5").status).toBe("reached");
    expect(byId(results, "foo6")).toMatchObject({
      status: "behind",
      nextStep: "Pat 401k: $8,500.00 of room",
    });
    expect(byId(results, "foo7").status).toBe("behind");
    expect(byId(results, "foo9")).toMatchObject({
      status: "onTrack",
      expectedYear: 2045,
    });
    expect(currentFooStep(results)).toBe(6);
  });

  it("flags match left on the table", () => {
    const r = byId(
      run({ match: { captured: 2_000, available: 3_000 } }),
      "foo2",
    );
    expect(r).toMatchObject({
      status: "behind",
      alert: true,
      short: "$1,000.00/yr missed",
    });
  });

  it("treats no match offered as done", () => {
    expect(
      byId(run({ match: { captured: 0, available: 0 } }), "foo2").status,
    ).toBe("reached");
  });

  it("can't judge other debt it has no rates for", () => {
    const input = makeInput();
    input.years[2] = { ...input.years[2]!, otherLiabilities: 2_400 };
    const r = byId(evaluateMilestones(input), "foo3");
    expect(r.status).toBe("unknown");
    expect(r.headline).toBe("$2,400.00 of other debt");
  });

  it("asks for a Roth IRA when step 5 has no accounts", () => {
    const r = byId(run({ limits: [] }), "foo5");
    expect(r.status).toBe("behind");
    expect(byId(run({ limits: [] }), "foo6").status).toBe("unknown");
  });

  it("ticked checklist items complete steps 1 and 8", () => {
    const results = run({ checklist: { deductibles: true, prepaid: true } });
    expect(byId(results, "foo1").status).toBe("reached");
    expect(byId(results, "foo8").status).toBe("reached");
  });

  it("every step reached → no current step", () => {
    const results = run({
      checklist: { deductibles: true, prepaid: true },
      limits: [],
      savings: {
        rate: 0.3,
        saved: 45_000,
        savedWithMatch: 50_000,
        compensation: 150_000,
        matchCounted: true,
      },
    }).map((r) => (r.id === "foo5" ? { ...r, status: "reached" as const } : r));
    expect(currentFooStep(results)).toBeNull();
  });
});

describe("saving, safety and home", () => {
  it("savings rate says what closes the gap to 25%", () => {
    const r = byId(run(), "savingsRate");
    expect(r.status).toBe("behind");
    // 25% of 150k = 37.5k; saved 33k → 375/mo
    expect(r.nextStep).toBe("$375.00 more a month reaches 25%");
  });

  it("emergency fund: reached at 3 months, alert under 1", () => {
    expect(byId(run({ efundMonths: 3 }), "emergencyFund").status).toBe(
      "reached",
    );
    expect(byId(run({ efundMonths: 4 }), "emergencyFund").note).toBe(
      "6 months is fully stocked",
    );
    expect(byId(run({ efundMonths: 0.5 }), "emergencyFund")).toMatchObject({
      status: "behind",
      alert: true,
    });
    expect(byId(run({ efundMonths: null }), "emergencyFund").status).toBe(
      "unknown",
    );
  });

  it("protection checklist is due in your 40s", () => {
    expect(byId(run(), "protection").status).toBe("onTrack");
    const input = makeInput();
    input.years[2] = { ...input.years[2]!, age: 42 };
    expect(byId(evaluateMilestones(input), "protection").status).toBe("behind");
    expect(
      byId(
        run({
          checklist: { will: true, termLife: true, healthDirective: true },
        }),
        "protection",
      ).status,
    ).toBe("reached");
  });

  it("3/5/25 housing bands", () => {
    const at = (cost: number) =>
      byId(
        run({
          mortgage: {
            active: true,
            monthlyHousingCost: cost,
            payoffYear: 2045,
          },
        }),
        "housing",
      ).status;
    expect(at(2_500)).toBe("reached"); // 20%
    expect(at(3_500)).toBe("onTrack"); // 28%
    expect(at(4_000)).toBe("behind"); // 32%
    expect(byId(run({ mortgage: null }), "housing").status).toBe("unknown");
  });

  it("a balance still owed is never read as paid off", () => {
    // Loan details missing, but the year's figures still carry a balance.
    const results = run({ mortgage: null });
    expect(byId(results, "paidOffHome").status).not.toBe("reached");
    expect(byId(results, "foo9").status).toBe("onTrack");
  });

  it("paid-off home by 60", () => {
    expect(byId(run(), "paidOffHome")).toMatchObject({
      status: "onTrack",
      expectedAge: 54,
    });
    expect(
      byId(
        run({
          mortgage: {
            active: true,
            monthlyHousingCost: 2_500,
            payoffYear: 2056,
          },
        }),
        "paidOffHome",
      ).status,
    ).toBe("behind");
    const input = makeInput({
      mortgage: { active: false, monthlyHousingCost: 0, payoffYear: null },
    });
    input.years[2] = { ...input.years[2]!, mortgageBalance: 0 };
    expect(byId(evaluateMilestones(input), "paidOffHome")).toMatchObject({
      status: "reached",
      reachedYear: 2026,
    });
  });
});

describe("investing (Bogleheads)", () => {
  const holdings = (
    classes: { name: string; share: number; targetShare: number | null }[],
  ) =>
    run({
      holdings: {
        coverage: 0.95,
        classes,
        expenseRatio: 0.0005,
        costCoverage: 0.9,
      },
    });

  it("5/25 bands: 5 points absolute or 25% of the target", () => {
    const inBand = holdings([
      { name: "US stocks", share: 0.62, targetShare: 0.6 },
      { name: "Bonds", share: 0.38, targetShare: 0.4 },
    ]);
    expect(byId(inBand, "rebalance").status).toBe("reached");
    const off = holdings([
      { name: "US stocks", share: 0.77, targetShare: 0.75 },
      { name: "Bonds", share: 0.1, targetShare: 0.15 },
      { name: "Cash", share: 0.13, targetShare: 0.1 },
    ]);
    const r = byId(off, "rebalance");
    expect(r.status).toBe("behind");
    expect(r.nextStep).toBe("Bonds 5.0 pts under · Cash 3.0 pts over");
  });

  it("low cost at or under 0.20%", () => {
    expect(byId(holdings([]), "lowCost").status).toBe("reached");
    const pricey = run({
      holdings: {
        coverage: 0.9,
        classes: [],
        expenseRatio: 0.006,
        costCoverage: 0.9,
      },
    });
    expect(byId(pricey, "lowCost").status).toBe("behind");
  });

  it("needs enough linked holdings", () => {
    const thin = run({
      holdings: {
        coverage: 0.5,
        classes: [{ name: "US", share: 1, targetShare: 0.6 }],
        expenseRatio: 0.001,
        costCoverage: 0.5,
      },
    });
    expect(byId(thin, "rebalance").status).toBe("unknown");
    expect(byId(thin, "lowCost").status).toBe("unknown");
    expect(byId(run(), "rebalance").status).toBe("unknown");
  });
});

describe("custom goals", () => {
  const goal = {
    id: "g1",
    label: "Half a million invested",
    metric: "liquid" as const,
    target: 500_000,
    todaysDollars: false,
    setYear: 2026,
  };

  it("projects a nominal goal", () => {
    const r = byId(run({ customGoals: [goal] }), "custom:g1");
    expect(r).toMatchObject({
      group: "custom",
      source: "custom",
      status: "onTrack",
    });
    // 300k × 1.1^n ≥ 500k → n = 6
    expect(r.expectedYear).toBe(2032);
  });

  it("grows a today's-dollars goal with inflation", () => {
    const r = byId(
      run({ customGoals: [{ ...goal, todaysDollars: true }] }),
      "custom:g1",
    );
    // 300k × 1.1^n ≥ 500k × 1.03^n → n = 8
    expect(r.expectedYear).toBe(2034);
  });

  it("dates a reached goal from history", () => {
    const r = byId(
      run({ customGoals: [{ ...goal, target: 200_000 }] }),
      "custom:g1",
    );
    expect(r).toMatchObject({ status: "reached", reachedYear: 2025 });
  });

  it("parses stored settings, reading bad data as empty", () => {
    expect(
      parseMilestoneSettings({
        customGoals: [goal],
        checklist: { will: true },
      }),
    ).toEqual({
      customGoals: [goal],
      checklist: { will: true },
    });
    expect(
      parseMilestoneSettings({
        customGoals: [{ ...goal, target: -1 }],
        checklist: { nope: true },
      }),
    ).toEqual({ customGoals: [], checklist: {} });
    expect(
      parseMilestoneSettings({ customGoals: null, checklist: null }),
    ).toEqual({
      customGoals: [],
      checklist: {},
    });
    expect(
      parseMilestoneSettings({ customGoals: [goal, goal], checklist: {} })
        .customGoals,
    ).toEqual([]);
  });
});

describe("summaries", () => {
  it("timeline lists reached milestones in date order", () => {
    const timeline = milestoneTimeline(run());
    expect(timeline.length).toBeGreaterThan(0);
    const years = timeline.map((t) => t.year);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
  });

  it("next up skips reached milestones and the FOO", () => {
    const next = nextUpMilestones(run());
    expect(next.length).toBe(2);
    for (const r of next) {
      expect(r.status).not.toBe("reached");
      expect(r.group).not.toBe("foo");
    }
  });

  it("since last year compares the last finalized year with now", () => {
    expect(sinceLastYear(makeInput().years)).toEqual({
      fromYear: 2025,
      netWorth: [320_000, 400_000],
      liquidMultiple: [1.6, 2],
      wealthScore: [1.1, 1.2],
    });
    expect(sinceLastYear([makeYear()])).toBeNull();
  });

  it("returns nothing without history", () => {
    expect(evaluateMilestones(makeInput({ years: [] }))).toEqual([]);
  });
});

describe("input builders", () => {
  it("maps a history row: retirement vs brokerage, finalized contributions only", () => {
    const row = {
      year: 2025,
      isCurrent: false,
      averageAge: 34,
      netWorthMarket: 320_000,
      portfolioTotal: 215_000,
      portfolioByType: { "401k": 150_000, ira: 30_000, brokerage: 35_000 },
      portfolioByTaxLocation: null,
      cash: 25_000,
      grossIncome: 150_000,
      perfContributions: 30_000,
      perfEmployerMatch: 5_000,
      aawScoreMarket: 1.1,
      fiProgress: 0.16,
      mortgageBalance: 210_000,
      otherLiabilities: 0,
    };
    expect(milestoneYearFromHistory(row)).toMatchObject({
      liquid: 240_000,
      cash: 25_000,
      retirement: 180_000,
      brokerage: 35_000,
      contributions: 35_000,
    });
    expect(
      milestoneYearFromHistory({ ...row, isCurrent: true }).contributions,
    ).toBeNull();
    // Each account's own parent category wins over its type's default.
    expect(
      milestoneYearFromHistory({
        ...row,
        portfolioByTaxLocation: {
          retirement: { preTax: 150_000, taxFree: 30_000, afterTax: 10_000 },
          portfolio: { afterTax: 25_000 },
        },
      }),
    ).toMatchObject({ retirement: 190_000, brokerage: 25_000 });
  });

  it("projection years hold today's cash flat and stop pay at retirement", () => {
    const years = milestoneProjectionYears(
      [
        {
          year: 2026,
          age: 64,
          phase: "accumulation",
          endBalance: 1_000_000,
          projectedSalary: 150_000,
          totalEmployee: 30_000,
          totalEmployer: 5_000,
        },
        { year: 2027, age: 65, phase: "decumulation", endBalance: 1_050_000 },
      ],
      40_000,
    );
    expect(years).toEqual([
      {
        year: 2026,
        age: 64,
        liquid: 1_040_000,
        salary: 150_000,
        contributions: 35_000,
      },
      {
        year: 2027,
        age: 65,
        liquid: 1_090_000,
        salary: null,
        contributions: null,
      },
    ]);
  });

  it("limits group 401k + 403b per person and count a family HSA once", () => {
    const acct = (
      categoryKey: string,
      employeeContrib: number,
      limit: number,
      totalContrib = employeeContrib,
    ) => ({
      categoryKey,
      accountType: categoryKey,
      limit,
      employeeContrib,
      totalContrib,
    });
    const rows = milestoneLimits(
      [
        {
          name: "Pat",
          accountTypes: [
            acct("401k", 10_000, 23_500),
            acct("403b", 5_000, 23_500),
            acct("hsa", 4_000, 8_550, 5_000),
          ],
        },
        {
          name: "Sam",
          accountTypes: [
            acct("ira", 7_000, 7_000),
            acct("brokerage", 9_000, 0),
          ],
        },
      ],
      [],
    );
    expect(rows).toEqual([
      {
        step: 6,
        owner: "Pat",
        label: "401k",
        contributed: 15_000,
        limit: 23_500,
      },
      {
        step: 5,
        owner: "Household",
        label: "HSA",
        contributed: 5_000,
        limit: 8_550,
      },
      { step: 5, owner: "Sam", label: "IRA", contributed: 7_000, limit: 7_000 },
    ]);
  });

  it("holdings shares are of the money whose mix is known", () => {
    expect(
      milestoneHoldings({
        allocation: {
          total: 100,
          unknown: 20,
          rows: [
            { name: "US", value: 60, targetPct: 0.7 },
            { name: "Bonds", value: 20, targetPct: null },
          ],
        },
        cost: { expenseRatio: 0.001, coveredShare: 0.9 },
      }),
    ).toEqual({
      coverage: 0.8,
      classes: [
        { name: "US", share: 0.75, targetShare: 0.7 },
        { name: "Bonds", share: 0.25, targetShare: null },
      ],
      expenseRatio: 0.001,
      costCoverage: 0.9,
    });
  });

  it("buildMilestoneInput applies Money Guy's savings rate and the mortgage costs", () => {
    const account = {
      categoryKey: "401k",
      accountType: "401k",
      limit: 23_500,
      employeeContrib: 15_000,
      totalContrib: 20_000,
      employerMatch: 5_000,
      employerMatchAvailable: 7_500,
      parentCategory: "Retirement",
      tradContrib: 15_000,
      taxFreeContrib: 0,
      afterTaxContrib: 0,
      hsaContrib: 0,
      views: {
        projected: { employeeContrib: 15_000, totalContrib: 20_000 },
        blended: { employeeContrib: 15_000, totalContrib: 20_000 },
        ytd: { employeeContrib: 10_000, totalContrib: 13_000 },
      },
    };
    const totals = {
      retirementWithoutMatch: 15_000,
      retirementWithMatch: 20_000,
      portfolioWithoutMatch: 0,
      portfolioWithMatch: 0,
      compensation: 100_000,
    };
    const base = {
      inputs: {
        asOfYear: 2026,
        years: [makeYear({ cash: 12_000 })],
        fiTarget: 1_000_000,
        customGoals: [],
        checklist: {},
      },
      contributions: {
        people: [
          {
            person: { name: "Pat" },
            totalCompensation: 100_000,
            salary: 100_000,
            accountTypes: [account],
            totals: {
              views: { projected: totals, blended: totals, ytd: totals },
            },
          },
        ],
        jointAccountTypes: [],
      },
      efundMonths: 5,
      mortgage: {
        loans: [
          {
            id: 1,
            principalAndInterest: "1800.00",
            pmi: "0",
            insuranceAndTaxes: "450.00",
          },
        ],
        activeLoanId: 1,
        activeLoanResult: {
          remainingMonths: 200,
          payoffDate: "2043-05-01T00:00:00.000Z",
        },
      },
      projection: null,
      holdings: null,
    };
    const below = buildMilestoneInput({
      ...base,
      highIncomeThreshold: 200_000,
    });
    expect(below.savings).toEqual({
      rate: 0.2,
      saved: 20_000,
      savedWithMatch: 20_000,
      compensation: 100_000,
      matchCounted: true,
    });
    expect(below.match).toEqual({ captured: 5_000, available: 7_500 });
    expect(below.mortgage).toEqual({
      active: true,
      monthlyHousingCost: 2_250,
      payoffYear: 2043,
    });
    const above = buildMilestoneInput({ ...base, highIncomeThreshold: 90_000 });
    expect(above.savings).toMatchObject({ rate: 0.15, matchCounted: false });
  });
});
