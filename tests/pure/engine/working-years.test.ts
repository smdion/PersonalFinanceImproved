/**
 * A person's working years from their job's dates (workingYearsByPerson):
 * outside them they earn nothing and their contributions stop, in whole
 * years; their salary keeps growing underneath for when they're at work.
 */
import { assert, describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import type {
  ProjectionInput,
  ContributionSpec,
  EngineAccumulationYear,
} from "@/lib/pure/engine/types";
import type { AccountCategory } from "@/lib/config/account-types";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";
import { makeAccumulationDefaults } from "../fixtures/engine-fixtures";

const AS_OF = new Date("2025-01-01");

function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return withCapsAge({
    budgetContributionLines: 0,
    accumulationDefaults: makeAccumulationDefaults({
      accountSplits: {
        "401k": 0.4,
        "403b": 0,
        hsa: 0.1,
        ira: 0.15,
        brokerage: 0.35,
      },
    }),
    decumulationDefaults: {
      withdrawalRate: 0.04,
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      withdrawalSplits: {
        "401k": 0.35,
        "403b": 0,
        ira: 0.25,
        brokerage: 0.3,
        hsa: 0.1,
      },
      withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
      distributionTaxRates: {
        ...shippedTaxTables(),
        traditionalFallbackRate: 0.22,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 40,
    retirementYear: AS_OF.getFullYear() + 25,
    projectionEndYear: AS_OF.getFullYear() + 50,
    currentSalary: 150000,
    salaryGrowthRate: 0.03,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    irsLimitCaps: capsFromBaseLimits({
      baseLimits: {
        "401k": 23500,
        "403b": 23500,
        hsa: 4300,
        ira: 7000,
        brokerage: 0,
      },
      catchupLimits: {
        "401k": 7500,
        ira: 1000,
        hsa: 1000,
        "401k_super": 11250,
      },
      currentAge: 40,
    }),
    limitGrowthRate: 0.02,

    employerMatchRateByCategory: {
      "401k": 0.03,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    startingBalances: {
      preTax: 110000,
      taxFree: 40000,
      afterTax: 30000,
      afterTaxBasis: 20000,
      hsa: 15000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 80000,
        roth: 20000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 15000 },
      ira: { structure: "roth_traditional", traditional: 30000, roth: 20000 },
      brokerage: { structure: "basis_tracking", balance: 30000, basis: 20000 },
    },
    annualExpenses: 72000,
    inflationRate: 0.025,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 36000,
    ssStartAge: 67,
    asOfDate: AS_OF,
    ...overrides,
  });
}

const spec = (
  personId: number,
  over: Partial<ContributionSpec> = {},
): ContributionSpec => ({
  category: "401k" as AccountCategory,
  name: `401k — Person ${personId}`,
  method: "fixed_monthly",
  value: 1000,
  salaryFraction: 0.5,
  periodsPerYear: 12,
  baseAnnual: 12000,
  taxTreatment: "pre_tax",
  personId,
  ...over,
});

const accumulation = (input: ProjectionInput) =>
  calculateProjection(input).projectionByYear.filter(
    (y): y is EngineAccumulationYear => y.phase === "accumulation",
  );
const at = (years: EngineAccumulationYear[], year: number) =>
  years.find((y) => y.year === year)!;

describe("working years from job dates", () => {
  const twoEarners = {
    salaryByPerson: { 1: 90000, 2: 60000 },
    currentSalary: 150000,
    contributionSpecs: [spec(1), spec(2)],
  };

  it("absent: everyone works throughout (unchanged)", () => {
    const base = accumulation(makeInput(twoEarners));
    const same = accumulation(
      makeInput({ ...twoEarners, workingYearsByPerson: {} }),
    );
    expect(same.map((y) => y.totalEmployee)).toEqual(
      base.map((y) => y.totalEmployee),
    );
  });

  it("after a job's last year: no salary and no contributions for that person", () => {
    const years = accumulation(
      makeInput({
        ...twoEarners,
        workingYearsByPerson: { 2: { start: null, end: 2027 } },
      }),
    );
    // 2027 counts in full; from 2028 only person 1 earns and contributes.
    expect(at(years, 2027).projectedSalaryByPerson![2]).toBeGreaterThan(0);
    expect(at(years, 2028).projectedSalaryByPerson![2]).toBe(0);
    // Person 1's $1,000 a month alone, grown at the limit growth rate.
    expect(at(years, 2028).totalEmployee).toBeCloseTo(12000 * 1.02 ** 3, 0);
  });

  it("before a job starts: nothing; from its start year its salary has grown", () => {
    const years = accumulation(
      makeInput({
        ...twoEarners,
        workingYearsByPerson: { 2: { start: 2028, end: null } },
      }),
    );
    expect(at(years, 2027).projectedSalaryByPerson![2]).toBe(0);
    expect(at(years, 2028).projectedSalaryByPerson![2]).toBeCloseTo(
      60000 * 1.03 ** 3,
      0,
    );
  });

  it("the match follows the person who earns it", () => {
    // Only person 1's 401(k) is matched: $3,000 of $150,000 household pay.
    const input = {
      ...twoEarners,
      contributionSpecs: [spec(1, { employerShare: 1 }), spec(2)],
      baseYearEmployerMatch: {
        "401k": 3000,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      employerMatchRateByCategory: {
        "401k": 0.02,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
    };
    const both = accumulation(makeInput(input));
    const oneAway = accumulation(
      makeInput({
        ...input,
        workingYearsByPerson: { 2: { start: null, end: 2027 } },
      }),
    );
    // Person 2 leaving doesn't cut person 1's match (the household rate on
    // person 1's pay alone would give 2% of 90,000 grown, not 3,000 grown).
    expect(at(oneAway, 2028).totalEmployer).toBeCloseTo(
      at(both, 2028).totalEmployer,
      0,
    );
    expect(at(oneAway, 2028).totalEmployer).toBeCloseTo(3000 * 1.03 ** 3, 0);
  });

  it("one earner: the household's salary and contributions stop", () => {
    const years = accumulation(
      makeInput({
        contributionSpecs: [spec(1, { salaryFraction: 1 })],
        workingYearsByPerson: { 1: { start: null, end: 2026 } },
      }),
    );
    expect(at(years, 2026).totalEmployee).toBeGreaterThan(0);
    expect(at(years, 2027).projectedSalary).toBe(0);
    expect(at(years, 2027).totalEmployee).toBe(0);
  });

  it("nobody at work: joint savings stop too", () => {
    const years = accumulation(
      makeInput({
        contributionSpecs: [
          spec(1, { salaryFraction: 1 }),
          spec(0, { personId: null, category: "brokerage" as AccountCategory }),
        ],
        workingYearsByPerson: { 1: { start: null, end: 2026 } },
      }),
    );
    expect(at(years, 2026).totalEmployee).toBeGreaterThan(0);
    expect(at(years, 2027).totalEmployee).toBe(0);
  });

  it("a partial retirement stops that person's fixed-dollar contributions too", () => {
    // Year 0 = 2025, household age 40 retiring at 65 (2050). Person 2,
    // born 1975, retires at 55 (2030): 2029 is their last working year.
    const years = accumulation(
      makeInput({
        ...twoEarners,
        retirementYearByPerson: { 1: 2050, 2: 2030 },
        socialSecurityEntries: [
          {
            personId: 1,
            personName: "One",
            birthYear: 1985,
            startAge: 67,
            annualAmount: 20000,
          },
          {
            personId: 2,
            personName: "Two",
            birthYear: 1975,
            startAge: 67,
            annualAmount: 16000,
          },
        ],
      }),
    );
    expect(at(years, 2029).projectedSalaryByPerson![2]).toBeGreaterThan(0);
    expect(at(years, 2030).projectedSalaryByPerson![2]).toBe(0);
    // Only person 1's $1,000 a month from 2030, grown at the limit rate.
    expect(at(years, 2030).totalEmployee).toBeCloseTo(12000 * 1.02 ** 5, 0);
  });

  it("a salary the household sets after an early retirement counts as working", () => {
    const years = accumulation(
      makeInput({
        ...twoEarners,
        retirementYearByPerson: { 1: 2050, 2: 2030 },
        socialSecurityEntries: [
          {
            personId: 1,
            personName: "One",
            birthYear: 1985,
            startAge: 67,
            annualAmount: 20000,
          },
          {
            personId: 2,
            personName: "Two",
            birthYear: 1975,
            startAge: 67,
            annualAmount: 16000,
          },
        ],
        // Part-time work from 2032.
        perPersonSalaryOverrides: [{ personId: 2, year: 2032, value: 30000 }],
      }),
    );
    expect(at(years, 2031).projectedSalaryByPerson![2]).toBe(0);
    expect(at(years, 2032).projectedSalaryByPerson![2]).toBe(30000);
    expect(at(years, 2033).projectedSalaryByPerson![2]).toBeCloseTo(30900, 0);
  });
});

describe("each person's own raise rate", () => {
  const twoEarners = {
    salaryByPerson: { 1: 90000, 2: 60000 },
    currentSalary: 150000,
    salaryGrowthRate: 0.03,
    contributionSpecs: [spec(1), spec(2)],
  };

  it("each salary grows at its owner's rate, and the household total follows", () => {
    const years = accumulation(
      makeInput({
        ...twoEarners,
        salaryGrowthRateByPerson: { 1: 0.04, 2: 0 },
      }),
    );
    const second = years[1]!;
    expect(second.projectedSalaryByPerson![1]).toBeCloseTo(93600, 2);
    expect(second.projectedSalaryByPerson![2]).toBe(60000);
    expect(second.projectedSalary).toBeCloseTo(153600, 2);
  });

  it("no map, or a person missing from it: the household rate", () => {
    const base = accumulation(makeInput(twoEarners));
    const partial = accumulation(
      makeInput({ ...twoEarners, salaryGrowthRateByPerson: { 1: 0.03 } }),
    );
    expect(partial[1]!.projectedSalaryByPerson).toEqual(
      base[1]!.projectedSalaryByPerson,
    );
    expect(base[1]!.projectedSalaryByPerson![2]).toBeCloseTo(61800, 2);
  });

  it("the salary cap and a year's override still apply per person", () => {
    const years = accumulation(
      makeInput({
        ...twoEarners,
        salaryCap: 91000,
        salaryGrowthRateByPerson: { 1: 0.04, 2: 0 },
      }),
    );
    expect(years[1]!.projectedSalaryByPerson![1]).toBe(91000);
  });
});

describe("each person's own retirement year", () => {
  const twoEarners = {
    salaryByPerson: { 1: 100000, 2: 100000 },
    currentSalary: 200000,
  };

  it("ends only the earlier retiree's pay, and ages come from the input's anchor", () => {
    const years = calculateProjection(
      makeInput({
        ...twoEarners,
        currentAge: 39,
        retirementYear: 2034,
        retirementYearByPerson: { 1: 2030, 2: 2034 },
      }),
    ).projectionByYear;
    expect(years.find((y) => y.year === 2029)!.phase).toBe("accumulation");
    const partial = years.find((y) => y.year === 2030)!;
    expect(partial.phase).toBe("accumulation");
    expect(partial.age).toBe(44);
    expect(years.find((y) => y.year === 2033)!.phase).toBe("accumulation");
    expect(years.find((y) => y.year === 2034)!.phase).toBe("decumulation");
  });

  it("needs no Social Security entry to stop a person's pay", () => {
    const run = (byPerson: Record<number, number>) =>
      calculateProjection(
        makeInput({
          ...twoEarners,
          socialSecurityEntries: undefined,
          retirementYear: 2034,
          retirementYearByPerson: byPerson,
        }),
      ).projectionByYear.find((y) => y.year === 2031)!;
    const employee = (y: ReturnType<typeof run>) => {
      assert(y.phase === "accumulation");
      return y.totalEmployee;
    };
    expect(employee(run({ 1: 2030, 2: 2034 }))).toBeLessThan(
      employee(run({ 1: 2034, 2: 2034 })),
    );
  });

  it("runs to the projection's end year whatever the anchor age", () => {
    const years = calculateProjection(
      makeInput({ currentAge: 39, projectionEndYear: 2030 }),
    ).projectionByYear;
    expect(years.at(-1)!.year).toBe(2029);
  });
});
