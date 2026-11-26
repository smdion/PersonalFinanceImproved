/**
 * Two earners, Ann and Bo, both 40 in 2026, each with their own pay and
 * raises and a $100,000 401(k); Bo's 401(k) spec takes a 4% match. Also
 * Bo's fixed brokerage saving, which scales with his own pay.
 */
import type {
  ContributionSpec,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import { acct, household } from "./two-person-household";
import { paysInto } from "./engine-fixtures";
import { withAccountId } from "./engine-input";

/** Bo's 401(k), which Bo's 401(k) spec pays. */
export const BO_401K = paysInto(withAccountId(acct("Bo 401k", "401k", 0, 2)));

const returnRates = Array.from({ length: 60 }, (_, i) => ({
  label: `Age ${40 + i}`,
  rate: 0.06,
}));

export function twoEarners(
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
      contributionAccountId: 1,
      account: BO_401K,
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
      retirementYear: 2046,
      projectionEndYear: 2048,
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

/** Bo's $1,200 a month into his own brokerage, which holds no balance yet. */
export const boBrokerageSaving: Partial<ContributionSpec>[] = [
  {
    category: "brokerage",
    name: "Bo brokerage",
    taxTreatment: "after_tax",
    method: "fixed_monthly",
    value: 1200,
    salaryFraction: 0,
    baseAnnual: 1200,
    personId: 2,
    contributionAccountId: 1,
    account: paysInto(
      withAccountId(acct("Bo brokerage", "brokerage", 0, 2, "afterTax")),
    ),
  },
];
