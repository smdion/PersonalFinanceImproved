/**
 * The gap-year couple: Ann and Bo, both 50 in 2026; Ann retires in 2030 and
 * Bo works to 2035, so 2030–2034 are gap years. Also the saving each named
 * gap-year case runs: Bo's 401(k) spec with its match, a stopped year that
 * is also a 0% year, and a Portfolio Roth saving.
 */
import type { ProjectionInput } from "@/lib/pure/engine/types";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { acct, household } from "./two-person-household";
import { paysInto } from "./engine-fixtures";
import { withAccountId } from "./engine-input";

export const returnRates = Array.from({ length: 70 }, (_, i) => ({
  label: `Age ${30 + i}`,
  rate: 0.05,
}));
export const payrollTax = {
  socialSecurityRate: 0.062,
  medicareRate: 0.0145,
  socialSecurityWageBase: 180000,
};
export const people = [1, 2].map((personId) => ({
  personId,
  personName: personId === 1 ? "Ann" : "Bo",
  birthYear: 1976,
  startAge: 70,
  annualAmount: 0,
}));

/** Ann's Roth IRA, all of it her contributions: before 59½ she draws it
 *  free of tax and penalty. */
export const annRoth = (): IndividualAccountInput => ({
  ...acct("Ann Roth IRA", "ira", 400000, 1, "taxFree"),
  rothBasisMeta: {
    year: 2026,
    contributionBasis: 400000,
    conversionBasis: 0,
    latestConversionYear: null,
    isSeeded: false,
    updatedAt: new Date("2026-01-01"),
  },
});

/** Both 50 in 2026. Ann retires in 2030, Bo works to 2035. */
export function couple(
  overrides: Partial<ProjectionInput> = {},
  accounts = [
    annRoth(),
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

/** A 4% 401(k) match. */
export const boMatch = {
  "401k": 0.04,
  "403b": 0,
  hsa: 0,
  ira: 0,
  brokerage: 0,
};

/** Bo's 10% 401(k) saving, into his own 401(k). */
export const boSavingSpecs = [
  {
    category: "401k",
    name: "Bo",
    taxTreatment: "pre_tax",
    method: "percent_of_salary",
    value: 0.1,
    salaryFraction: 0.4,
    baseAnnual: 6000,
    personId: 2,
    employerShare: 1,
    personPayShare: 1,
    allocationPriority: 0,
    // Bo's own 401(k), which holds no balance yet.
    contributionAccountId: 1,
    account: paysInto(withAccountId(acct("Bo 401k", "401k", 0, 2))),
  },
] satisfies ProjectionInput["contributionSpecs"];

/** Bo still has pay in 2031 and the plan's own rate is 10%, so the 0% row
 *  alone would be a pause; the household also stops saving in gap years. */
export function stoppedZeroRateCouple(): ProjectionInput {
  const contributionSpecs = [
    {
      category: "401k",
      name: "Bo 401k",
      taxTreatment: "pre_tax",
      method: "percent_of_salary",
      value: 0.1,
      salaryFraction: 0.4,
      baseAnnual: 6000,
      personId: 2,
      employerShare: 1,
      personPayShare: 1,
      allocationPriority: 0,
      // Bo's own accounts, which hold no balance yet.
      contributionAccountId: 1,
      account: paysInto(withAccountId(acct("Bo 401k", "401k", 0, 2))),
    },
    {
      category: "ira",
      name: "Bo IRA",
      taxTreatment: "pre_tax",
      method: "fixed_monthly",
      value: 500,
      salaryFraction: 0.4,
      baseAnnual: 6000,
      personId: 2,
      personPayShare: 1,
      allocationPriority: 0,
      contributionAccountId: 2,
      account: paysInto(withAccountId(acct("Bo IRA", "ira", 0, 2))),
    },
  ] satisfies ProjectionInput["contributionSpecs"];
  const base = couple({
    contributionSpecs,
    gapYearStopSaving: true,
    employerMatchRateByCategory: boMatch,
  });
  return {
    ...base,
    accumulationDefaults: {
      ...base.accumulationDefaults,
      contributionRate: 0.1,
    },
    accumulationOverrides: [{ year: 2031, contributionRate: 0 }],
  };
}

/** Bo's Portfolio Roth IRA, $20,000. */
export const portfolioRoth = {
  ...acct("Bo Portfolio Roth", "ira", 20000, 2, "taxFree"),
  parentCategory: "Portfolio",
};
/** Bo's $6,000 a year into his Portfolio Roth. */
export const portfolioSavingSpecs = [
  {
    category: "ira",
    name: "Bo Portfolio Roth",
    method: "fixed_annual",
    value: 6000,
    salaryFraction: 0,
    baseAnnual: 6000,
    taxTreatment: "tax_free",
    personId: 2,
    ownerName: "Bo",
    allocationPriority: 0,
    parentCategory: "Portfolio",
    contributionScaling: "fixed_amount",
    contributionAccountId: 1,
    account: paysInto(withAccountId(portfolioRoth)),
  },
] satisfies ProjectionInput["contributionSpecs"];
