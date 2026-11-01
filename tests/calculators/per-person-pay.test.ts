/**
 * Two people, two raises: what follows pay follows each person's own pay,
 * not the household's. The match on Bo's spec stays flat while Ann's raises
 * lift the household, and so does Bo's fixed brokerage saving.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type {
  ContributionSpec,
  EngineAccumulationYear,
  ProjectionInput,
} from "@/lib/calculators/types";
import { acct, household } from "./fixtures/two-person-household";

const returnRates = Array.from({ length: 60 }, (_, i) => ({
  label: `Age ${40 + i}`,
  rate: 0.06,
}));

function twoEarners(
  overrides: Partial<ProjectionInput> = {},
  specs: Partial<ContributionSpec>[] = [
    {
      category: "401k",
      name: "Bo",
      method: "percent_of_salary",
      value: 0.05,
      salaryFraction: 0.4,
      baseAnnual: 3000,
      personId: 2,
      employerShare: 1,
      personPayShare: 1,
    },
  ],
): ProjectionInput {
  const people = [
    {
      personId: 1,
      personName: "Ann",
      birthYear: 1986,
      startAge: 70,
      annualAmount: 0,
    },
    {
      personId: 2,
      personName: "Bo",
      birthYear: 1986,
      startAge: 70,
      annualAmount: 0,
    },
  ];
  return household(
    [acct("Ann 401k", "401k", 100000, 1), acct("Bo 401k", "401k", 100000, 2)],
    {
      currentAge: 40,
      birthYear: 1986,
      retirementAge: 60,
      projectionEndAge: 62,
      returnRates,
      currentSalary: 150000,
      salaryGrowthRate: 0.03,
      salaryByPerson: { 1: 90000, 2: 60000 },
      salaryGrowthRateByPerson: { 1: 0.1, 2: 0 },
      employerMatchRateByCategory: {
        "401k": 0.04,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      baseYearEmployerMatch: {
        "401k": 6000,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      socialSecurityEntries: people,
      perPersonBirthYears: [1986, 1986],
      contributionSpecs: specs.map((s) => ({
        taxTreatment: "pre_tax",
        periodsPerYear: 12,
        ownerName: "Bo",
        ...s,
      })) as ContributionSpec[],
      ...overrides,
    },
  );
}

const accumulation = (input: ProjectionInput) =>
  calculateProjection(input).projectionByYear.filter(
    (y): y is EngineAccumulationYear => y.phase === "accumulation",
  );
const matchOn = (y: EngineAccumulationYear) =>
  y.slots.find((s) => s.category === "401k")?.employerMatch ?? 0;

describe("pay that moves apart", () => {
  it("the match follows its own person's pay, not the household's", () => {
    const years = accumulation(twoEarners());
    expect(matchOn(years[1]!)).toBeCloseTo(6000, 0);
    expect(matchOn(years[19]!)).toBeCloseTo(6000, 0);
  });

  it("a person's raise moves the match on their own spec", () => {
    const years = accumulation(
      twoEarners({ salaryGrowthRateByPerson: { 1: 0, 2: 0.1 } }),
    );
    expect(matchOn(years[2]!)).toBeCloseTo(6000 * 1.1 ** 2, 0);
  });

  it("a fixed saving that scales with pay follows its own person", () => {
    const input = twoEarners({}, [
      {
        category: "brokerage",
        name: "Bo brokerage",
        method: "fixed_monthly",
        value: 1200,
        salaryFraction: 0,
        baseAnnual: 1200,
        personId: 2,
      },
    ]);
    const y = accumulation(input)[10]!;
    const slot = y.slots.find((s) => s.category === "brokerage");
    expect(slot?.employeeContrib).toBeCloseTo(1200, 0);
  });

  it("raises that match keep the household figure", () => {
    const years = accumulation(
      twoEarners({ salaryGrowthRateByPerson: { 1: 0.03, 2: 0.03 } }),
    );
    expect(matchOn(years[5]!)).toBeCloseTo(6000 * 1.03 ** 5, 0);
  });
});
