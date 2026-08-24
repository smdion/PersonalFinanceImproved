/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Extended contribution helper tests.
 *
 * Tests aggregateContributionsByCategory, resolveProfile,
 * applyContribActiveFields, applyJobActiveFields, and buildContributionDisplaySpecs.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import {
  aggregateContributionsByCategory,
  resolveProfile,
  applyContribActiveFields,
  buildContributionDisplaySpecs,
  classifyContribResolution,
} from "@/server/helpers/contribution";
import type { AccountCategory } from "@/lib/calculators/types";
import type { SalaryProfileActiveMap } from "@/server/helpers/salary";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContribRow(
  overrides: Partial<{
    id: number;
    personId: number;
    jobId: number | null;
    accountType: AccountCategory;
    subType: string | null;
    label: string | null;
    parentCategory: string;
    contributionMethod: string;
    contributionValue: string;
    taxTreatment: string;
    employerMatchType: string | null;
    employerMatchValue: string | null;
    employerMaxMatchPct: string | null;
  }> = {},
) {
  return {
    id: 1,
    personId: 1,
    jobId: 1,
    accountType: "401k" as AccountCategory,
    subType: null,
    label: null,
    parentCategory: "Retirement",
    contributionMethod: "percent_of_salary",
    contributionValue: "10",
    taxTreatment: "pre_tax",
    employerMatchType: null,
    employerMatchValue: null,
    employerMaxMatchPct: null,
    ...overrides,
  };
}

function makeJob(id = 1, personId = 1, payPeriod = "biweekly") {
  return { id, personId, payPeriod };
}

function makeJobSalary(jobId = 1, personId = 1, salary = 120000) {
  return { job: { id: jobId, personId }, salary };
}

// ---------------------------------------------------------------------------
// aggregateContributionsByCategory
// ---------------------------------------------------------------------------

describe("aggregateContributionsByCategory", () => {
  it("aggregates a single 401k contribution", () => {
    const contribs = [makeContribRow()];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const { contribByCategory, employerMatchByCategory } =
      aggregateContributionsByCategory(contribs, jobs, salaries);

    // 10% of 120000 = 12000
    expect(contribByCategory["401k"].annual).toBe(12000);
    expect(contribByCategory["401k"].tradAnnual).toBe(12000);
    expect(contribByCategory["401k"].rothAnnual).toBe(0);
    expect(contribByCategory["401k"].rothFraction).toBe(0);
    expect(employerMatchByCategory["401k"]).toBe(0);
  });

  it("computes Roth fraction correctly", () => {
    const contribs = [
      makeContribRow({
        id: 1,
        contributionValue: "8",
        taxTreatment: "pre_tax",
      }),
      makeContribRow({
        id: 2,
        contributionValue: "4",
        taxTreatment: "tax_free",
      }),
    ];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const { contribByCategory } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    // Pre-tax: 8% of 120k = 9600, Roth: 4% of 120k = 4800
    // Roth fraction = 4800 / (9600 + 4800) = 0.333...
    expect(contribByCategory["401k"].annual).toBeCloseTo(14400);
    expect(contribByCategory["401k"].rothFraction).toBeCloseTo(1 / 3);
  });

  it("includes employer match by category", () => {
    const contribs = [
      makeContribRow({
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "100",
        employerMaxMatchPct: "0.06",
      }),
    ];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const { employerMatchByCategory } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    // Match: 120000 × min(0.10, 0.06) × 1.0 = 7200
    expect(employerMatchByCategory["401k"]).toBe(7200);
  });

  it("aggregates across multiple categories", () => {
    const contribs = [
      makeContribRow({
        id: 1,
        accountType: "401k" as AccountCategory,
        contributionValue: "10",
      }),
      makeContribRow({
        id: 2,
        accountType: "ira" as AccountCategory,
        contributionValue: "5",
        taxTreatment: "tax_free",
      }),
      makeContribRow({
        id: 3,
        accountType: "hsa" as AccountCategory,
        contributionMethod: "fixed_annual",
        contributionValue: "4300",
      }),
    ];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const { contribByCategory } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    expect(contribByCategory["401k"].annual).toBe(12000);
    expect(contribByCategory["ira"].annual).toBe(6000);
    expect(contribByCategory["hsa"].annual).toBe(4300);
  });

  it("handles zero salary gracefully", () => {
    const contribs = [makeContribRow()];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary(1, 1, 0)];

    const { contribByCategory } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    expect(contribByCategory["401k"].annual).toBe(0);
  });

  it("tracks employer match by parent category", () => {
    const contribs = [
      makeContribRow({
        parentCategory: "Retirement — Employer",
        employerMatchType: "dollar_match",
        employerMatchValue: "5000",
      }),
    ];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const { employerMatchByParentCat } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    const catMap = employerMatchByParentCat.get("401k" as AccountCategory);
    expect(catMap).toBeDefined();
    expect(catMap!.get("Retirement — Employer")).toBe(5000);
  });

  it("falls back to person's first job when jobId is null", () => {
    const contribs = [makeContribRow({ jobId: null, personId: 2 })];
    const jobs = [makeJob(10, 2, "monthly")];
    const salaries = [makeJobSalary(10, 2, 100000)];

    const { contribByCategory } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    // 10% of 100000 = 10000
    expect(contribByCategory["401k"].annual).toBe(10000);
  });

  it("marks a fixed_per_period account incomplete and excludes it when its job can't be resolved (method-gated treatment)", () => {
    const contribs = [
      makeContribRow({
        id: 1,
        jobId: 99, // no job with this id in `jobs` below — ended/missing link
        contributionMethod: "fixed_per_period",
        contributionValue: "500",
      }),
    ];
    const jobs = [makeJob(1, 1, "biweekly")]; // a different, unrelated job
    const salaries = [makeJobSalary(1, 1, 120000)];

    const { contribByCategory, incompleteAccountIds } =
      aggregateContributionsByCategory(contribs, jobs, salaries);

    expect(incompleteAccountIds).toEqual([1]);
    // Excluded from the total (0), not defaulted to a guessed pay period.
    expect(contribByCategory["401k"].annual).toBe(0);
  });

  it("does NOT mark percent_of_salary/fixed_monthly accounts incomplete for the same missing-job scenario", () => {
    const contribs = [
      makeContribRow({
        id: 1,
        jobId: 99,
        contributionMethod: "percent_of_salary",
        contributionValue: "10",
      }),
      makeContribRow({
        id: 2,
        jobId: 99,
        contributionMethod: "fixed_monthly",
        contributionValue: "200",
      }),
    ];
    const jobs = [makeJob(1, 1, "biweekly")];
    const salaries = [makeJobSalary(1, 1, 120000)];

    const { incompleteAccountIds } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    expect(incompleteAccountIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyContribActiveFields
// ---------------------------------------------------------------------------

describe("applyContribActiveFields", () => {
  // A raw account row — no contributionValue/contributionMethod of its own;
  // accounts carry no value anymore, only whichever profile is in effect.
  const baseRow = {
    id: 1,
    personId: 1,
    jobId: 1,
    accountType: "401k",
    subType: null,
    label: null,
    parentCategory: "Retirement",
    taxTreatment: "pre_tax",
    isActive: true,
    employerMatchType: null,
    employerMatchValue: null,
    employerMaxMatchPct: null,
    employerMatchTaxTreatment: null,
    isPayrollDeducted: true,
    performanceAccountId: null,
    targetAnnual: null,
    allocationPriority: null,
    displayOrder: 0,
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
  } as unknown as (typeof import("@/lib/db/schema").contributionAccounts)["$inferSelect"];

  it("excludes rows with no active fields — no fallback to a base value", () => {
    const result = applyContribActiveFields([baseRow], {});
    expect(result).toHaveLength(0);
  });

  it("applies active fields", () => {
    const result = applyContribActiveFields([baseRow], {
      "1": { contributionValue: "15", contributionMethod: "percent_of_salary" },
    });
    expect(result[0].contributionValue).toBe("15");
  });

  it("filters out rows with isActive=false active field", () => {
    const result = applyContribActiveFields([baseRow], {
      "1": {
        contributionValue: "15",
        contributionMethod: "percent_of_salary",
        isActive: false,
      },
    });
    expect(result).toHaveLength(0);
  });

  it("excludes an entry with isActive alone and no value — still no fallback", () => {
    const result = applyContribActiveFields([baseRow], {
      "1": { isActive: false },
    });
    expect(result).toHaveLength(0);
  });

  it("leaves other rows untouched", () => {
    const row2 = { ...baseRow, id: 2 } as typeof baseRow;
    const result = applyContribActiveFields([baseRow, row2], {
      "1": { contributionValue: "20", contributionMethod: "percent_of_salary" },
      "2": { contributionValue: "10", contributionMethod: "percent_of_salary" },
    });
    expect(result).toHaveLength(2);
    expect(result[0].contributionValue).toBe("20");
    expect(result[1].contributionValue).toBe("10");
  });

  it("overlay mode keeps an already-resolved row when this layer has no entry for it", () => {
    const resolved = {
      ...baseRow,
      contributionValue: "10",
      contributionMethod: "percent_of_salary",
    };
    const result = applyContribActiveFields([resolved], {}, true);
    expect(result).toHaveLength(1);
    expect(result[0].contributionValue).toBe("10");
  });

  it("overlay mode overrides an already-resolved row when this layer has an entry", () => {
    const resolved = {
      ...baseRow,
      contributionValue: "10",
      contributionMethod: "percent_of_salary",
    };
    const result = applyContribActiveFields(
      [resolved],
      { "1": { contributionValue: "999", contributionMethod: "fixed_annual" } },
      true,
    );
    expect(result[0].contributionValue).toBe("999");
  });
});

// ---------------------------------------------------------------------------
// classifyContribResolution
// ---------------------------------------------------------------------------

describe("classifyContribResolution", () => {
  const rawIds = new Set([1, 2, 3]);

  it("returns account_unavailable when the account isn't in the global active fetch", () => {
    const status = classifyContribResolution(
      99,
      rawIds,
      {},
      new Set(),
      new Set(),
    );
    expect(status).toBe("account_unavailable");
  });

  it("returns not_in_profile when the profile has no contributionValue entry", () => {
    const status = classifyContribResolution(
      1,
      rawIds,
      {},
      new Set([1]),
      new Set(),
    );
    expect(status).toBe("not_in_profile");
  });

  it("returns inactive_in_profile when the profile's entry sets isActive: false", () => {
    const status = classifyContribResolution(
      1,
      rawIds,
      { "1": { contributionValue: "100", isActive: false } },
      new Set(),
      new Set(),
    );
    expect(status).toBe("inactive_in_profile");
  });

  it("returns inactive_in_sandbox when the profile resolves but the account didn't survive the sandbox overlay", () => {
    const status = classifyContribResolution(
      1,
      rawIds,
      { "1": { contributionValue: "100" } },
      new Set(), // sandbox overlay dropped it
      new Set(),
    );
    expect(status).toBe("inactive_in_sandbox");
  });

  it("returns no_pay_period when the account resolved but has no resolvable pay period", () => {
    const status = classifyContribResolution(
      1,
      rawIds,
      { "1": { contributionValue: "100" } },
      new Set([1]),
      new Set([1]),
    );
    expect(status).toBe("no_pay_period");
  });

  it("returns ok when the account fully resolves", () => {
    const status = classifyContribResolution(
      1,
      rawIds,
      { "1": { contributionValue: "100" } },
      new Set([1]),
      new Set(),
    );
    expect(status).toBe("ok");
  });
});

// applyJobActiveFields / the Contribution Profile `jobs` active-fields
// bucket no longer exist — Stage B deleted them wholesale. Pay schedule,
// W-4 elections, and bonus pay date/flags now come from the Salary
// Profile entry (see mergeSalaryProfileJobFields), and employerName has no
// profile-override path at all any more (accepted feature reduction, see
// RULES.md's Salary Profile layer section).

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

describe("resolveProfile", () => {
  const makeProfile = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 1,
      name: "Test Profile",
      contributionActiveFields: {
        contributionAccounts: {},
      },
      ...overrides,
    }) as unknown as (typeof import("@/lib/db/schema").contributionProfiles)["$inferSelect"];

  // resolveProfile merges pay-schedule/W-4/bonus-date fields from the
  // caller's own resolved Salary Profile map (mergeSalaryProfileJobFields)
  // — no longer from a Contribution Profile `jobs` bucket.
  const salaryProfileActiveMap: SalaryProfileActiveMap = new Map([
    [
      1,
      {
        salary: 120000,
        bonusPercent: 0,
        bonusMultiplier: 1,
        monthsInBonusYear: 12,
        bonusOverride: null,
        payPeriod: "biweekly",
        payWeek: "na",
        anchorPayDate: null,
        budgetPeriodsPerMonth: null,
        w4FilingStatus: "MFJ",
        w4Box2cChecked: false,
        additionalFedWithholding: 0,
        bonusMonth: null,
        bonusDayOfMonth: null,
        include401kInBonus: false,
        includeBonusInContributions: false,
      },
    ],
  ]);

  const liveContrib = {
    id: 10,
    personId: 1,
    jobId: 1,
    accountType: "401k" as AccountCategory,
    subType: null,
    label: null,
    parentCategory: "Retirement",
    contributionMethod: "percent_of_salary",
    contributionValue: "10",
    taxTreatment: "pre_tax",
    employerMatchType: null,
    employerMatchValue: null,
    employerMaxMatchPct: null,
  };

  // A job carries no salary/bonus of its own any more — resolveProfile's J
  // generic only needs identity + payroll-basis fields. Salary/bonus
  // resolution happens upstream (against the active Salary Profile, see
  // loadLiveContribData) — resolveProfile no longer takes a salaries
  // parameter at all; it just applies contribution/job active-field
  // overrides on top of whatever liveJobSalaries already resolved to.
  const liveJob = {
    id: 1,
    personId: 1,
    payPeriod: "biweekly",
    endDate: null,
    includeBonusInContributions: false,
    employerName: "OldCorp",
  } as (typeof import("@/lib/db/schema").jobs)["$inferSelect"];

  const liveJobSalary = {
    job: { id: 1, personId: 1 },
    salary: 120000,
    // Base salary BEFORE bonus — the multiplicand every bonus formula uses.
    // `salary` above is the payroll basis and may already include a bonus.
    baseSalary: 120000,
    totalComp: 130000,
    resolvedBonusOverride: null,
  };

  it("passes through the already-resolved salary/totalComp untouched", () => {
    const profile = makeProfile();
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
      salaryProfileActiveMap,
    );

    expect(result.jobSalaries[0].salary).toBe(120000);
    expect(result.jobSalaries[0].totalComp).toBe(130000);
    expect(result.combinedSalary).toBe(120000);
  });

  it("excludes contribs with no active value for an empty profile — no fallback", () => {
    const profile = makeProfile();
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
      salaryProfileActiveMap,
    );

    expect(result.activeContribs).toHaveLength(0);
    expect(result.combinedSalary).toBe(120000);
  });

  it("applies contribution overrides", () => {
    const profile = makeProfile({
      contributionActiveFields: {
        contributionAccounts: {
          "10": { contributionValue: "15" },
        },
      },
    });
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
      salaryProfileActiveMap,
    );

    expect(result.activeContribs[0].contributionValue).toBe("15");
  });

  it("filters out contributions deactivated by override", () => {
    const profile = makeProfile({
      contributionActiveFields: {
        contributionAccounts: {
          "10": { isActive: false },
        },
      },
    });
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
      salaryProfileActiveMap,
    );

    expect(result.activeContribs).toHaveLength(0);
  });

  it("merges pay-schedule fields from the Salary Profile map onto patchedJobs", () => {
    // The Contribution Profile `jobs` bucket that used to own employerName/
    // bonus-date overrides is gone — patchedJobs' non-comp fields now come
    // entirely from mergeSalaryProfileJobFields against salaryProfileActiveMap.
    const profile = makeProfile();
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
      salaryProfileActiveMap,
    );

    expect(result.patchedJobs[0].payPeriod).toBe("biweekly");
    expect(result.patchedJobs[0].w4FilingStatus).toBe("MFJ");
  });
});

// ---------------------------------------------------------------------------
// buildContributionDisplaySpecs
// ---------------------------------------------------------------------------

describe("buildContributionDisplaySpecs", () => {
  it("builds specs from contribution rows", () => {
    const contribs = [makeContribRow({ contributionValue: "10" })];
    const people = [{ id: 1, name: "Alice" }];
    const jobs = [makeJob()];
    const salaries = [{ ...makeJobSalary(), totalComp: 120000 }];

    // Need full JobSalaryRef shape
    const jobSalaryRefs = salaries.map((s) => ({
      job: { id: s.job.id, personId: s.job.personId },
      salary: s.salary,
    }));

    const specs = buildContributionDisplaySpecs(
      contribs,
      people,
      jobs,
      jobSalaryRefs,
    );

    expect(specs).toHaveLength(1);
    expect(specs[0].category).toBe("401k");
    expect(specs[0].baseAnnual).toBe(12000);
    expect(specs[0].ownerName).toBe("Alice");
    expect(specs[0].personId).toBe(1);
  });

  it("filters out zero-value contributions", () => {
    const contribs = [makeContribRow({ contributionValue: "0" })];
    const specs = buildContributionDisplaySpecs(
      contribs,
      [{ id: 1, name: "Alice" }],
      [makeJob()],
      [makeJobSalary()],
    );
    expect(specs).toHaveLength(0);
  });

  it("redistributes match proportionally within person+category group", () => {
    // Only one of the two sibling rows carries real match config — the
    // schema/computeGroupedEmployerMatch invariant (at most one row per
    // job/person + accountType + parentCategory group may have real
    // config; two independently-configured siblings is a data-integrity
    // error, covered separately below).
    const contribs = [
      makeContribRow({
        id: 1,
        contributionValue: "10", // 12000
        taxTreatment: "pre_tax",
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "100",
        employerMaxMatchPct: "0.06",
      }),
      makeContribRow({
        id: 2,
        contributionValue: "5", // 6000
        taxTreatment: "tax_free",
      }),
    ];
    const people = [{ id: 1, name: "Alice" }];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const specs = buildContributionDisplaySpecs(
      contribs,
      people,
      jobs,
      salaries,
    );

    expect(specs).toHaveLength(2);
    // Combined rate = 18000/120000 = 0.15, capped at 0.06 -> total match
    // = 120000 * 0.06 * 1.0 = 7200, split 2:1 by contribution share.
    const totalMatch = specs.reduce((s, sp) => s + sp.matchAnnual, 0);
    expect(totalMatch).toBeCloseTo(7200);
    // Pre-tax has 2x the contribution, so should get 2x the match
    expect(specs[0].matchAnnual).toBeCloseTo(specs[1].matchAnnual * 2, 0);
  });

  it("throws when two sibling rows both carry real match config", () => {
    const contribs = [
      makeContribRow({
        id: 1,
        contributionValue: "10",
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "100",
        employerMaxMatchPct: "0.06",
      }),
      makeContribRow({
        id: 2,
        contributionValue: "5",
        taxTreatment: "tax_free",
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "100",
        employerMaxMatchPct: "0.06",
      }),
    ];
    expect(() =>
      buildContributionDisplaySpecs(
        contribs,
        [{ id: 1, name: "Alice" }],
        [makeJob()],
        [makeJobSalary()],
      ),
    ).toThrow(/independently carry employer match config/);
  });
});
