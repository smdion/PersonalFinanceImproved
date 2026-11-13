/**
 * The server cap pass: rows keep their configured value, gain a capped
 * value every calculation reads, and the yearly money figured from the
 * capped value is exactly the module's capped amount. Invented figures.
 */
import "../../../helpers/setup-mocks";
import { describe, it, expect } from "vitest";
import { xfail } from "../../../fixtures/answer-key";
import { capEffectiveContribs } from "@/lib/pure/contributions/cap-pass";
import {
  capAtYearRate,
  capForRequest,
  withLeftThisYear,
} from "@/lib/pure/contributions/cap-request";
import {
  BLANK_SALARY_ENTRY,
  type SalaryEntry,
} from "@/lib/db/shapes/salary-entry-defaults";
import { buildContribAccounts } from "@/lib/pure/contributions/paycheck-accounts";
import {
  annualContributionWithBonus,
  type ContributionRow,
} from "@/lib/pure/contributions/contribution-rows";
import { aggregateContributionsByCategory } from "@/lib/pure/contributions/category-totals";

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
  over: Partial<ContributionRow> & { hsaCoverageType?: string | null },
): ContributionRow & { hsaCoverageType?: string | null } {
  return {
    id: nextId++,
    personId: 1,
    jobId: 10,
    accountType: "401k",
    subType: null,
    label: null,
    parentCategory: "Retirement",
    contributionMethod: "percent_of_salary" as const,
    contributionValue: "10",
    taxTreatment: "pre_tax",
    employerMatchType: null,
    employerMatchValue: null,
    employerMaxMatchPct: null,
    isPayrollDeducted: true,
    fromBonus: false,
    ownership: "individual",
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
const yearly = (c: ContributionRow) => {
  const js = jobSalaries.find((j) => j.job.id === c.jobId)!;
  const periods = c.jobId === 10 ? 26 : 12;
  return annualContributionWithBonus(c, js, periods);
};

describe("capEffectiveContribs", () => {
  it("keeps the configured value and gives a capped value whose yearly money is the capped amount", () => {
    const pct = row({ contributionValue: "8", fromBonus: true }); // 8% of 240k = 19,200
    const fixed = row({
      contributionMethod: "fixed_per_period" as const,
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
      contributionMethod: "fixed_per_period" as const,
      contributionValue: "400", // 4,800/yr
      employerMatchType: "percent_of_contribution" as const,
      employerMatchValue: "100",
    });
    const [out] = capEffectiveContribs([hsa], ctx);
    const agg = aggregateContributionsByCategory([out!], jobs, jobSalaries);
    expect(agg.contribByCategory.hsa.annual).toBeCloseTo(2000, 2);
    expect(
      agg.contribByCategory.hsa.annual + agg.employerMatchByCategory.hsa,
    ).toBeCloseTo(4000, 2);
  });

  it("reads a match value as every other reader does (parseFloat): 100abc is 100, not none", () => {
    const hsa = (employerMatchValue: string) =>
      row({
        personId: 2,
        jobId: 20,
        accountType: "hsa",
        taxTreatment: "hsa",
        hsaCoverageType: "self_only",
        contributionMethod: "fixed_per_period" as const,
        contributionValue: "400",
        employerMatchType: "percent_of_contribution" as const,
        employerMatchValue,
      });
    const [plain] = capEffectiveContribs([hsa("100")], ctx);
    const [trailing] = capEffectiveContribs([hsa("100abc")], ctx);
    expect(trailing!.cappedValue).toBeCloseTo(plain!.cappedValue!, 10);
    expect(trailing!.cappedValue).toBeCloseTo(2000 / 12, 2);
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

  it("an over-limit HSA's capped contribution is FICA-exempt in full", () => {
    const hsa = row({
      personId: 2,
      jobId: 20,
      accountType: "hsa",
      taxTreatment: "hsa",
      hsaCoverageType: "self_only",
      contributionMethod: "fixed_per_period" as const,
      contributionValue: "500", // 6,000/yr, over 4,000
      employerMatchType: "fixed_annual" as const,
      employerMatchValue: "1000",
    });
    const [out] = capEffectiveContribs([hsa], ctx);
    const [acct] = buildContribAccounts(
      [{ ...out!, isActive: true } as never],
      [],
      60000,
      { periodsPerYear: 12, salaryDivisor: 12 },
      { limits, ageAtYearEnd: 40 },
      0,
    );
    expect(acct!.annualContribution).toBeCloseTo(3000, 2); // 4,000 − 1,000
    // Already within the limit less employer money: no further FICA-exempt cap.
    expect(acct!.ficaExemptAnnualCap).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// capForRequest: the request's jobs and pay
// ---------------------------------------------------------------------------

const limits415 = {
  "401k_employee_limit": 24500,
  "401k_catchup_limit": 8000,
  "401k_super_catchup_limit": 11250,
  "401k_total_additions_limit": 72000,
  ira_limit: 7500,
  ira_catchup_limit: 1100,
};
const jobAt = (
  id: number,
  dates: { startDate: string; endDate: string | null } = {
    startDate: "2020-01-01",
    endDate: null,
  },
  payPeriod: "biweekly" | "monthly" = "biweekly",
) => ({
  id,
  personId: 1,
  payPeriod,
  ...dates,
  isSpeculative: false,
  anchorPayDate: null,
  bonusMonth: null,
  bonusDayOfMonth: null,
});
const planRow = (id: number, jobId: number | null, value: number) => ({
  id,
  personId: 1,
  jobId,
  accountType: jobId === null ? "ira" : "401k",
  contributionMethod: "fixed_annual" as const,
  contributionValue: String(value),
  taxTreatment: jobId === null ? "tax_free" : "pre_tax",
  employerMatchType: null,
  employerMatchValue: null,
  employerMaxMatchPct: null,
  isPayrollDeducted: jobId !== null,
  ownership: "individual" as const,
});
const salaryEntry = (salary: number): SalaryEntry => ({
  ...BLANK_SALARY_ENTRY,
  salary,
});

describe("capForRequest — a What-If salary is the current job's only", () => {
  // Two current jobs: job 1 (first on file, the current job) pays 50,000 and job 2 pays
  // 100,000 on the Salary Profile; a What-If salary of 2,000. Job 1 is paid 2,000, so its
  // 5,000 401(k) is held to that pay (415(c)(1)(B)); job 2 keeps 100,000, so its 15,000
  // fits; the IRA's compensation is 2,000 + 100,000 − 2,000 − 15,000 = 85,000 (219(f)(1)).
  const capped = capForRequest(
    [planRow(1, 1, 5000), planRow(2, 2, 15000), planRow(3, null, 7500)],
    {
      people: [{ id: 1, birthYear: 1990 }],
      limits: limits415,
      filingStatus: "Single",
      taxYear: 2030,
      asOf: new Date(2030, 2, 1),
    },
    [jobAt(1), jobAt(2)],
    new Map([
      [1, salaryEntry(50000)],
      [2, salaryEntry(100000)],
    ]),
    new Map([[1, { salary: 2000 }]]),
  );
  const kept = (id: number) =>
    capped.find((c) => c.id === id)!.cap!.cappedAnnual;

  it("pays the What-If salary at the current job", () => {
    expect(kept(1)).toBeCloseTo(2000, 2);
  });
  it("keeps the other job's Salary Profile pay", () => {
    expect(kept(2)).toBeCloseTo(15000, 2);
  });
  it("counts both jobs' pay toward the IRA", () => {
    expect(kept(3)).toBeCloseTo(7500, 2);
  });
});

describe("capForRequest — this tax year's checks", () => {
  const perCheck = (
    id: number,
    jobId: number,
    accountType: "401k" | "hsa",
    value: number,
  ) => ({
    ...planRow(id, jobId, value),
    accountType,
    contributionMethod: "fixed_per_period" as const,
    taxTreatment: accountType === "hsa" ? "hsa" : "pre_tax",
    hsaCoverageType: accountType === "hsa" ? "self_only" : null,
  });
  const run = (
    rows: ReturnType<typeof perCheck>[],
    jobs: ReturnType<typeof jobAt>[],
    pass = capForRequest<ReturnType<typeof perCheck>>,
  ) =>
    pass(
      rows,
      {
        people: [{ id: 1, birthYear: 1990 }],
        limits: {
          ...limits415,
          hsa_individual_limit: 4000,
          hsa_catchup_limit: 1000,
        },
        filingStatus: "Single",
        taxYear: 2030,
        asOf: new Date(2030, 7, 14),
      },
      jobs,
      new Map(jobs.map((j) => [j.id, salaryEntry(120000)])),
      new Map(),
    );
  const monthly = (
    id: number,
    startDate: string,
    endDate: string | null = null,
  ) => jobAt(id, { startDate, endDate }, "monthly");

  it("a job started July 1 pays six checks: a 500 HSA check fits this year, the rate is cut", () => {
    // Six monthly checks of 500 = 3,000, under 4,000; a year of them (6,000) is cut to 4,000.
    const rows = [perCheck(1, 1, "hsa", 500)];
    const jobs = [monthly(1, "2030-07-01")];
    expect(run(rows, jobs)[0]!.cappedValue).toBeCloseTo(500, 2);
    expect(run(rows, jobs, capAtYearRate)[0]!.cappedValue).toBeCloseTo(
      4000 / 12,
      2,
    );
  });

  it("an ended job's checks are already in: never cut, and the job held now takes the rest", () => {
    // January to April at job 1: 4 × 2,500 = 10,000 already in. Job 2 from May: 8 × 2,500 =
    // 20,000, held to 24,500 − 10,000 = 14,500 this year (1,812.50 a check).
    const [earlier, now] = run(
      [perCheck(1, 1, "401k", 2500), perCheck(2, 2, "401k", 2500)],
      [monthly(1, "2030-01-01", "2030-04-30"), monthly(2, "2030-05-01")],
    );
    expect(earlier!.cappedValue).toBeCloseTo(2500, 2);
    expect(now!.cappedValue).toBeCloseTo(1812.5, 2);
  });

  it("an HSA whose job ended before December 1 is held to its months", () => {
    // January to April: 4,000 × 4/12 = 1,333.33 this year; 4 checks of 500 = 2,000, cut.
    const [hsa] = run(
      [perCheck(1, 1, "hsa", 500)],
      [monthly(1, "2030-01-01", "2030-04-30")],
    );
    expect(hsa!.cap!.cappedAnnual).toBeCloseTo(4000 / 3, 2);
  });
});

describe("withLeftThisYear — engine year 0 for a job starting or ending this year", () => {
  const hsaRow = {
    ...planRow(1, 1, 500),
    accountType: "hsa",
    contributionMethod: "fixed_per_period" as const,
    taxTreatment: "hsa",
    hsaCoverageType: "self_only",
  };
  const household = {
    people: [{ id: 1, birthYear: 1990 }],
    limits: { hsa_individual_limit: 4000, hsa_catchup_limit: 1000 },
    filingStatus: "Single",
    taxYear: 2030,
    asOf: new Date(2030, 7, 14),
  };
  const left = (startDate: string) => {
    const job = jobAt(1, { startDate, endDate: null }, "monthly");
    const pay = { job, salary: 120000, bonusGross: 0, totalComp: 120000 };
    const ctx = { ...household, activeJobs: [job], jobSalaries: [pay] };
    const [row] = withLeftThisYear(
      capEffectiveContribs([hsaRow], ctx),
      household,
      [job],
      [pay],
    );
    return row!.leftThisYear;
  };
  it("a job started July 1: this year's 3,000, less two of its six checks paid by August 14", () => {
    expect(left("2030-07-01")).toBeCloseTo(2000, 2);
  });
  it("a job held all year has none: its year 0 prorates by months", () => {
    expect(left("2020-01-01")).toBeUndefined();
  });
  // LM3Y (owner "LM3 year 0"): every job's year 0 by checks left. Held all
  // year, paid on the 1st: 12 checks, 8 paid by August 14 (January–August),
  // so 4 of 12 are left: the 4,000 self-only limit × 4/12 = 1,333.33.
  // Today it has none, and the engine prorates by months (5/12: 1,666.67).
  xfail({
    id: "limits/LM3Y-held-all-year",
    todo: `v0.11.1 LM3Y "Year 0 by checks left for every job" (DECISIONS LM3 year 0)`,
    run: () => left("2020-01-01") ?? Number.NaN,
    expected: 1333.33,
  });
});
