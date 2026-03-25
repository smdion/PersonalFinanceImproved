/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Extended contribution helper tests.
 *
 * Tests aggregateContributionsByCategory, resolveProfile,
 * applyContribOverrides, applyJobOverrides, and buildContributionDisplaySpecs.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import {
  aggregateContributionsByCategory,
  resolveProfile,
  applyContribOverrides,
  applyJobOverrides,
  buildContributionDisplaySpecs,
} from "@/server/helpers/contribution";
import type { AccountCategory } from "@/lib/calculators/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContribRow(
  overrides: Partial<{
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
        contributionValue: "8",
        taxTreatment: "pre_tax",
      }),
      makeContribRow({
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
        accountType: "401k" as AccountCategory,
        contributionValue: "10",
      }),
      makeContribRow({
        accountType: "ira" as AccountCategory,
        contributionValue: "5",
        taxTreatment: "tax_free",
      }),
      makeContribRow({
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
});

// ---------------------------------------------------------------------------
// applyContribOverrides
// ---------------------------------------------------------------------------

describe("applyContribOverrides", () => {
  const baseRow = {
    id: 1,
    personId: 1,
    jobId: 1,
    accountType: "401k",
    subType: null,
    label: null,
    parentCategory: "Retirement",
    contributionMethod: "percent_of_salary",
    contributionValue: "10",
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

  it("returns rows unchanged when no overrides", () => {
    const result = applyContribOverrides([baseRow], {});
    expect(result).toHaveLength(1);
    expect(result[0].contributionValue).toBe("10");
  });

  it("applies override fields", () => {
    const result = applyContribOverrides([baseRow], {
      "1": { contributionValue: "15" },
    });
    expect(result[0].contributionValue).toBe("15");
  });

  it("filters out rows with isActive=false override", () => {
    const result = applyContribOverrides([baseRow], {
      "1": { isActive: false },
    });
    expect(result).toHaveLength(0);
  });

  it("leaves other rows untouched", () => {
    const row2 = { ...baseRow, id: 2 } as typeof baseRow;
    const result = applyContribOverrides([baseRow, row2], {
      "1": { contributionValue: "20" },
    });
    expect(result).toHaveLength(2);
    expect(result[0].contributionValue).toBe("20");
    expect(result[1].contributionValue).toBe("10");
  });
});

// ---------------------------------------------------------------------------
// applyJobOverrides
// ---------------------------------------------------------------------------

describe("applyJobOverrides", () => {
  const baseJob = {
    id: 1,
    personId: 1,
    bonusPercent: "0.10",
    bonusMultiplier: "1.0",
    bonusOverride: null,
    monthsInBonusYear: 12,
    annualSalary: "120000",
    payPeriod: "biweekly",
    endDate: null,
  } as unknown as (typeof import("@/lib/db/schema").jobs)["$inferSelect"];

  it("returns jobs unchanged when no overrides", () => {
    const result = applyJobOverrides([baseJob], {});
    expect(result[0].bonusPercent).toBe("0.10");
  });

  it("applies valid override fields", () => {
    const result = applyJobOverrides([baseJob], {
      "1": { bonusPercent: "0.15", bonusMultiplier: "1.5" },
    });
    expect(result[0].bonusPercent).toBe("0.15");
    expect(result[0].bonusMultiplier).toBe("1.5");
  });

  it("ignores override fields not present on job", () => {
    const result = applyJobOverrides([baseJob], {
      "1": { nonExistentField: "value", bonusPercent: "0.20" },
    } as Record<string, Record<string, unknown>>);
    expect(result[0].bonusPercent).toBe("0.20");
    expect(
      (result[0] as Record<string, unknown>)["nonExistentField"],
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

describe("resolveProfile", () => {
  const makeProfile = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 1,
      name: "Test Profile",
      isDefault: false,
      salaryOverrides: {} as Record<string, number>,
      contributionOverrides: {
        contributionAccounts: {},
        jobs: {},
      },
      ...overrides,
    }) as unknown as (typeof import("@/lib/db/schema").contributionProfiles)["$inferSelect"];

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

  const liveJob = {
    id: 1,
    personId: 1,
    payPeriod: "biweekly",
    endDate: null,
    annualSalary: "120000",
    bonusPercent: "0.10",
    bonusMultiplier: "1.0",
    bonusOverride: null,
    monthsInBonusYear: 12,
    includeBonusInContributions: false,
  } as (typeof import("@/lib/db/schema").jobs)["$inferSelect"];

  const liveJobSalary = {
    job: { id: 1, personId: 1 },
    salary: 120000,
    totalComp: 130000,
  };

  it("returns unmodified data for empty profile", () => {
    const profile = makeProfile();
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
    );

    expect(result.activeContribs).toHaveLength(1);
    expect(result.activeContribs[0].contributionValue).toBe("10");
    expect(result.combinedSalary).toBe(120000);
  });

  it("applies salary overrides", () => {
    const profile = makeProfile({
      salaryOverrides: { "1": 150000 },
    });
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
    );

    expect(result.jobSalaries[0].salary).toBe(150000);
    expect(result.jobSalaries[0].totalComp).toBe(150000);
    expect(result.combinedSalary).toBe(150000);
  });

  it("applies contribution overrides", () => {
    const profile = makeProfile({
      contributionOverrides: {
        contributionAccounts: {
          "10": { contributionValue: "15" },
        },
        jobs: {},
      },
    });
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
    );

    expect(result.activeContribs[0].contributionValue).toBe("15");
  });

  it("filters out contributions deactivated by override", () => {
    const profile = makeProfile({
      contributionOverrides: {
        contributionAccounts: {
          "10": { isActive: false },
        },
        jobs: {},
      },
    });
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
    );

    expect(result.activeContribs).toHaveLength(0);
  });

  it("applies job overrides", () => {
    const profile = makeProfile({
      contributionOverrides: {
        contributionAccounts: {},
        jobs: {
          "1": { bonusPercent: "0.25" },
        },
      },
    });
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
    );

    expect(result.patchedJobs[0].bonusPercent).toBe("0.25");
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
    const contribs = [
      makeContribRow({
        contributionValue: "10", // 12000
        taxTreatment: "pre_tax",
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "100",
        employerMaxMatchPct: "0.06",
      }),
      makeContribRow({
        contributionValue: "5", // 6000
        taxTreatment: "tax_free",
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "100",
        employerMaxMatchPct: "0.06",
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
    // Total match should be redistributed proportionally
    const totalMatch = specs.reduce((s, sp) => s + sp.matchAnnual, 0);
    expect(totalMatch).toBeGreaterThan(0);
    // Pre-tax has 2x the contribution, so should get 2x the match
    expect(specs[0].matchAnnual).toBeCloseTo(specs[1].matchAnnual * 2, 0);
  });
});
