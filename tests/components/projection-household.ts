/**
 * An invented household for the projection card's smoke tests (rows and
 * card level), and the payload `projection.computeProjection` answers with
 * for it. The engine runs for real; only the router around it is stood in.
 *
 * Ann and Bo, both 50 in 2026. Ann stops work in 2029, Bo in 2033 (the plan
 * retires then). Ann's 401k and Roth IRA stay locked until she turns 59½ in
 * 2036; Bo's brokerage is the only money reachable before then, and runs out
 * in 2035.
 */
import type {
  ProjectionInput,
  ProjectionResult,
} from "@/lib/pure/engine/types";
import { acct, household } from "../calculators/fixtures/two-person-household";

const BIRTH_YEAR = 1976;
export const people = [
  { id: 1, name: "Ann", birthYear: BIRTH_YEAR },
  { id: 2, name: "Bo", birthYear: BIRTH_YEAR },
];

export function annAndBo(
  overrides: Partial<ProjectionInput> = {},
): ProjectionInput {
  return household(
    [
      {
        ...acct("Ann 401k", "401k", 300000, 1, "preTax"),
        ownerBirthYear: BIRTH_YEAR,
      },
      {
        ...acct("Ann Roth IRA", "ira", 150000, 1, "taxFree"),
        ownerBirthYear: BIRTH_YEAR,
      },
      {
        ...acct("Bo Brokerage", "brokerage", 250000, 2, "afterTax"),
        ownerBirthYear: BIRTH_YEAR,
      },
    ],
    {
      asOfDate: new Date("2026-01-01"),
      currentAge: 50,
      birthYear: BIRTH_YEAR,
      perPersonBirthYears: [BIRTH_YEAR, BIRTH_YEAR],
      socialSecurityEntries: people.map((p) => ({
        personId: p.id,
        personName: p.name,
        birthYear: BIRTH_YEAR,
        startAge: 70,
        annualAmount: 0,
      })),
      retirementYear: 2033,
      retirementYearByPerson: { 1: 2029, 2: 2033 },
      projectionEndYear: 2040,
      salaryByPerson: { 1: 90000, 2: 70000 },
      currentSalary: 160000,
      salaryGrowthRate: 0.02,
      annualExpenses: 90000,
      inflationRate: 0,
      returnRates: Array.from({ length: 70 }, (_, i) => ({
        label: `Age ${30 + i}`,
        rate: 0.05,
      })),
      ...overrides,
    },
  );
}

/** `projection.computeProjection`'s answer for one engine result. */
export function engineDataFor(result: ProjectionResult) {
  return {
    result,
    combinedSalary: 160000,
    people,
    realDefaults: {},
    dbSalaryOverrides: [],
    dbBudgetOverrides: [],
    primaryPersonId: 1,
    salaryByPerson: { 1: 90000, 2: 70000 },
    settings: {
      retirementAge: 57,
      endAge: 64,
      salaryAnnualIncrease: "0.02",
      annualInflation: "0",
      withdrawalRate: "0.04",
      rmdExcessHandling: "reinvest",
    },
    annualExpenses: 90000,
    decumulationExpenses: 90000,
    budgetProfileSummaries: [],
    contributionSpecs: [],
  };
}
