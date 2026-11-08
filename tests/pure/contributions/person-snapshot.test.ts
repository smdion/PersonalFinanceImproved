/**
 * contribAccountsFor takes its figures by name. Several share a type
 * (salary and total compensation, this year's and last year's limits, age
 * and periods per year): each is given a distinct value here, so reading
 * one in another's place moves a figure. Invented household: one person,
 * age 52, a 401(k) on their job and an IRA of their own.
 */
import { describe, expect, it } from "vitest";
import type { ContribAccountRow } from "@/lib/pure/contributions/contrib-account-row";
import { contribAccountsFor } from "@/lib/pure/contributions/person-snapshot";

const base: ContribAccountRow = {
  capPassed: true,
  id: 1,
  personId: 1,
  jobId: 10,
  accountType: "401k",
  parentCategory: "Retirement",
  subType: null,
  label: null,
  contributionMethod: "percent_of_salary",
  contributionValue: "10",
  taxTreatment: "pre_tax",
  employerMatchType: "none",
  employerMatchValue: null,
  employerMatchRate: null,
  employerMaxMatchPct: null,
  employerMatchTaxTreatment: "pre_tax",
  hsaCoverageType: null,
  isPayrollDeducted: null,
  fromBonus: false,
  ownership: "individual",
  performanceAccountId: null,
  targetAnnual: null,
  allocationPriority: 0,
  priorYearContribAmount: "0",
  priorYearContribYear: null,
};
const ira: ContribAccountRow = {
  ...base,
  id: 2,
  jobId: null,
  accountType: "ira",
  contributionMethod: "fixed_annual",
  contributionValue: "6000",
  isPayrollDeducted: false,
};

const thisYear = {
  "401k_employee_limit": 23500,
  "401k_catchup_limit": 7500,
  ira_limit: 7000,
  ira_catchup_limit: 1000,
};
const lastYear = {
  "401k_employee_limit": 23000,
  "401k_catchup_limit": 7000,
  ira_limit: 6500,
  ira_catchup_limit: 900,
};

const snapshot = () =>
  contribAccountsFor({
    effectiveContributions: [base, ira],
    activeJob: { id: 10, bonusMonth: null, bonusDayOfMonth: null },
    person: { id: 1, dateOfBirth: "1974-06-01" },
    pay: { salary: 100000, bonusGross: 0 },
    asOfDate: new Date(2026, 5, 15),
    salary: 100000,
    periodsPerYear: 26,
    limitsRecord: thisYear,
    totalCompensation: 125000,
    age: 52,
    priorYearLimitsRecord: lastYear,
  });

describe("contribAccountsFor reads each figure from its own field", () => {
  it("salary sizes the contribution; total compensation is the rate's base", () => {
    const { accounts, result } = snapshot();
    expect(accounts[0]!.annualContribution).toBe(10000);
    expect(result.accounts[0]!.percentOfSalary).toBeCloseTo(0.1);
    // (10,000 + 6,000) of 125,000 total compensation, not of salary.
    const rates = Object.values(result.groupRatesExMatch);
    expect(rates).toContainEqual(expect.closeTo(16000 / 125000, 5));
    expect(rates).not.toContainEqual(expect.closeTo(16000 / 100000, 5));
  });

  it("periods per year sizes the per-check amount", () => {
    const { accounts } = snapshot();
    expect(accounts[0]!.perPeriodContribution).toBeCloseTo(10000 / 26, 2);
  });

  it("this year's limits (with the age's catch-up) and last year's stay apart", () => {
    const { resolveContribLimit, resolveContribPriorYearLimit } = snapshot();
    expect(resolveContribLimit("401k", null)).toBe(23500 + 7500);
    expect(resolveContribLimit("ira", null)).toBe(7000 + 1000);
    expect(resolveContribPriorYearLimit("ira", null)).toBe(6500 + 900);
  });

  it("splits the job's rows from the person's own", () => {
    const { rawContribs } = snapshot();
    expect(rawContribs.map((c) => c.id)).toEqual([1, 2]);
  });
});
