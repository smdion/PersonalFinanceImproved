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
  applyJobActiveFields,
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
// applyJobActiveFields
// ---------------------------------------------------------------------------

describe("applyJobActiveFields", () => {
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
    bonusMonth: 2,
    includeBonusInContributions: false,
    employerName: "OldCorp",
  } as unknown as (typeof import("@/lib/db/schema").jobs)["$inferSelect"];

  it("returns jobs unchanged when no active fields", () => {
    const result = applyJobActiveFields([baseJob], {});
    expect(result[0].bonusPercent).toBe("0.10");
  });

  it("applies valid active fields", () => {
    const result = applyJobActiveFields([baseJob], {
      "1": { includeBonusInContributions: true, bonusMonth: 3 },
    });
    expect(result[0].includeBonusInContributions).toBe(true);
    expect(result[0].bonusMonth).toBe(3);
  });

  it("refuses bonus AMOUNT fields — they moved to the Salary Profile", () => {
    // A Contribution Profile must not be able to change anyone's
    // compensation. These names are still real jobs columns, so the plain
    // `field in job` filter would happily apply a stale stored key.
    const result = applyJobActiveFields([baseJob], {
      "1": {
        bonusPercent: "0.15",
        bonusMultiplier: "1.5",
        monthsInBonusYear: 6,
      },
    });
    expect(result[0].bonusPercent).toBe("0.10");
    expect(result[0].bonusMultiplier).toBe("1.0");
    expect(result[0].monthsInBonusYear).toBe(12);
  });

  it("ignores active fields not present on job", () => {
    const result = applyJobActiveFields([baseJob], {
      "1": { nonExistentField: "value", bonusMonth: 4 },
    } as Record<string, Record<string, unknown>>);
    expect(result[0].bonusMonth).toBe(4);
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
      contributionActiveFields: {
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
      contributionActiveFields: {
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

  it("applies job overrides it still owns", () => {
    const profile = makeProfile({
      contributionActiveFields: {
        contributionAccounts: {},
        jobs: {
          "1": { employerName: "NewCorp" },
        },
      },
    });
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
    );

    expect(result.patchedJobs[0].employerName).toBe("NewCorp");
  });

  it("REFUSES a stale bonus-amount job override", () => {
    // bonusPercent/bonusMultiplier/monthsInBonusYear moved to the Salary
    // Profile and are no longer real jobs columns at all. The override
    // filter is field-name-driven (`field in job`), so a leftover key in an
    // old contribution_active_fields row has nothing to land on any more —
    // this is the runtime backstop that makes a missed row inert, not
    // wrong.
    const profile = makeProfile({
      contributionActiveFields: {
        contributionAccounts: {},
        jobs: {
          "1": {
            bonusPercent: "0.25",
            bonusMultiplier: "3",
            monthsInBonusYear: 6,
          },
        },
      },
    });
    const result = resolveProfile(
      profile,
      [liveContrib],
      [liveJob],
      [liveJobSalary],
    );

    expect(result.patchedJobs[0]).not.toHaveProperty("bonusPercent");
    expect(result.patchedJobs[0]).not.toHaveProperty("bonusMultiplier");
    expect(result.patchedJobs[0]).not.toHaveProperty("monthsInBonusYear");
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
