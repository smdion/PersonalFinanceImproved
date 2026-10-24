/**
 * The server cap pass: rows keep their configured value, gain a capped
 * value every calculation reads, and the yearly money figured from the
 * capped value is exactly the module's capped amount. Invented figures.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { capEffectiveContribs } from "@/server/helpers/contribution-caps";
import {
  aggregateContributionsByCategory,
  annualContributionWithBonus,
  buildContribAccounts,
  type ContribRow,
} from "@/server/helpers/contribution";

const limits = {
  "401k_employee_limit": 20000,
  "401k_catchup_limit": 7000,
  "401k_super_catchup_limit": 10000,
  ira_limit: 6000,
  ira_catchup_limit: 1000,
  hsa_individual_limit: 4000,
  hsa_family_limit: 8000,
  hsa_catchup_limit: 1000,
};
const TAX_YEAR = 2030;
const jobs = [
  { id: 10, personId: 1, payPeriod: "biweekly" },
  { id: 20, personId: 2, payPeriod: "monthly" },
];
const jobSalaries = [
  {
    job: { id: 10, personId: 1 },
    salary: 200000,
    bonusGross: 40000,
    totalComp: 240000,
  },
  { job: { id: 20, personId: 2 }, salary: 60000, totalComp: 60000 },
];

let nextId = 1;
function row(
  over: Partial<ContribRow> & { hsaCoverageType?: string | null },
): ContribRow & { hsaCoverageType?: string | null } {
  return {
    id: nextId++,
    personId: 1,
    jobId: 10,
    accountType: "401k",
    subType: null,
    label: null,
    parentCategory: "Retirement",
    contributionMethod: "percent_of_salary",
    contributionValue: "10",
    taxTreatment: "pre_tax",
    employerMatchType: null,
    employerMatchValue: null,
    employerMaxMatchPct: null,
    isPayrollDeducted: true,
    fromBonus: false,
    ...over,
  };
}
const ctx = {
  activeJobs: jobs,
  jobSalaries,
  people: [
    { id: 1, birthYear: TAX_YEAR - 40 },
    { id: 2, birthYear: TAX_YEAR - 40 },
  ],
  limits,
  filingStatus: "MFJ",
  taxYear: TAX_YEAR,
};
const yearly = (c: ContribRow) => {
  const js = jobSalaries.find((j) => j.job.id === c.jobId)!;
  const periods = c.jobId === 10 ? 26 : 12;
  return annualContributionWithBonus(c, js, periods);
};

describe("capEffectiveContribs", () => {
  it("keeps the configured value and gives a capped value whose yearly money is the capped amount", () => {
    const pct = row({ contributionValue: "8", fromBonus: true }); // 8% of 240k = 19,200
    const fixed = row({
      contributionMethod: "fixed_per_period",
      contributionValue: "500", // 13,000/yr
      taxTreatment: "tax_free",
    });
    const out = capEffectiveContribs([pct, fixed], ctx);
    for (const c of out) {
      expect(c.contributionValue).toBe(
        [pct, fixed].find((r) => r.id === c.id)!.contributionValue,
      );
      expect(yearly(c)).toBeCloseTo(c.cap!.cappedAnnual, 2);
    }
    expect(out[0]!.cap!.cappedAnnual + out[1]!.cap!.cappedAnnual).toBeCloseTo(
      20000,
      2,
    );
    // One factor: the Roth / Traditional split holds.
    expect(out[0]!.cap!.cappedAnnual / out[1]!.cap!.cappedAnnual).toBeCloseTo(
      19200 / 13000,
      4, // a ratio of cent-rounded amounts
    );
  });

  it("an under-limit row is untouched", () => {
    const r = row({ contributionValue: "5" });
    const [out] = capEffectiveContribs([r], ctx);
    expect(out!.cappedValue).toBe(5);
    expect(out!.cap!.overBy).toBe(0);
  });

  it("an HSA with a 100% match lands exactly on the limit, the match figured on the capped amount", () => {
    const hsa = row({
      personId: 2,
      jobId: 20,
      accountType: "hsa",
      taxTreatment: "hsa",
      hsaCoverageType: "self_only",
      contributionMethod: "fixed_per_period",
      contributionValue: "400", // 4,800/yr
      employerMatchType: "percent_of_contribution",
      employerMatchValue: "100",
    });
    const [out] = capEffectiveContribs([hsa], ctx);
    const agg = aggregateContributionsByCategory([out!], jobs, jobSalaries);
    expect(agg.contribByCategory.hsa.annual).toBeCloseTo(2000, 2);
    expect(
      agg.contribByCategory.hsa.annual + agg.employerMatchByCategory.hsa,
    ).toBeCloseTo(4000, 2);
  });

  it("a re-run starts from the configured value (never compounds)", () => {
    const r = row({ contributionValue: "15" });
    const once = capEffectiveContribs([r], ctx);
    const twice = capEffectiveContribs(once, ctx);
    expect(twice[0]!.cappedValue).toBeCloseTo(once[0]!.cappedValue!, 10);
  });

  it("types without a limit get no cap fields", () => {
    const b = row({ accountType: "brokerage", taxTreatment: "after_tax" });
    const [out] = capEffectiveContribs([b], ctx);
    expect(out!.cap).toBeUndefined();
    expect(out!.cappedValue).toBeUndefined();
  });

  it("an over-limit HSA's FICA-exempt amount is its capped contribution", () => {
    const hsa = row({
      personId: 2,
      jobId: 20,
      accountType: "hsa",
      taxTreatment: "hsa",
      hsaCoverageType: "self_only",
      contributionMethod: "fixed_per_period",
      contributionValue: "500", // 6,000/yr, over 4,000
      employerMatchType: "fixed_annual",
      employerMatchValue: "1000",
    });
    const [out] = capEffectiveContribs([hsa], ctx);
    const [acct] = buildContribAccounts(
      [{ ...out!, isActive: true } as never],
      [],
      60000,
      12,
      { limits, ageAtYearEnd: 40 },
      0,
    );
    expect(acct!.annualContribution).toBeCloseTo(3000, 2); // 4,000 − 1,000
    expect(acct!.ficaExemptAnnualCap).toBeCloseTo(3000, 2);
  });
});
