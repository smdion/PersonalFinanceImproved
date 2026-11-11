/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
import "../../../helpers/setup-mocks";
import { describe, it, expect } from "vitest";
import {
  resolveProfile,
  applyContribActiveFields,
} from "@/server/services/contributions/profile";
import type { AccountCategory } from "@/lib/config/account-types";
import type { SalaryProfileActiveMap } from "@/lib/pure/household/compensation";

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
    expect(result[0]!.contributionValue).toBe("15");
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

  it("reads an unknown stored match type as no match and flags the account", () => {
    const odd = {
      ...baseRow,
      employerMatchType: "legacy",
    } as unknown as typeof baseRow;
    const [row] = applyContribActiveFields([odd], {
      "1": { contributionValue: "5", contributionMethod: "percent_of_salary" },
    });
    expect(row).toMatchObject({
      employerMatchType: "none",
      matchTypeUnrecognised: true,
    });
  });

  it("leaves other rows untouched", () => {
    const row2 = { ...baseRow, id: 2 } as typeof baseRow;
    const result = applyContribActiveFields([baseRow, row2], {
      "1": { contributionValue: "20", contributionMethod: "percent_of_salary" },
      "2": { contributionValue: "10", contributionMethod: "percent_of_salary" },
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.contributionValue).toBe("20");
    expect(result[1]!.contributionValue).toBe("10");
  });

  it("overlay mode keeps an already-resolved row when this layer has no entry for it", () => {
    const resolved = {
      ...baseRow,
      contributionValue: "10",
      contributionMethod: "percent_of_salary",
    };
    const result = applyContribActiveFields([resolved], {}, true);
    expect(result).toHaveLength(1);
    expect(result[0]!.contributionValue).toBe("10");
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
    expect(result[0]!.contributionValue).toBe("999");
  });
});

// applyJobActiveFields / the Contribution Profile `jobs` active-fields
// bucket no longer exist — Stage B deleted them wholesale. Pay schedule,
// W-4 elections, and bonus pay date/flags now come from the Salary
// Profile entry (see mergeSalaryProfileJobFields), and employerName has no
// profile-override path at all any more (accepted feature reduction, see
// DESIGN.md's Salary Profile layer section).

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
        extraPaycheckRouting: null,
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
  } as unknown as (typeof import("@/lib/db/schema").contributionAccounts)["$inferSelect"];

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
    employerName: "OldCorp",
    title: null,
    startDate: "2020-01-01",
    isSpeculative: false,
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

    expect(result.jobSalaries[0]!.salary).toBe(120000);
    expect(result.jobSalaries[0]!.totalComp).toBe(130000);
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
          "10": {
            contributionValue: "15",
            contributionMethod: "percent_of_salary",
          },
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

    expect(result.activeContribs[0]!.contributionValue).toBe("15");
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

    expect(result.patchedJobs[0]!.payPeriod).toBe("biweekly");
    expect(result.patchedJobs[0]!.w4FilingStatus).toBe("MFJ");
  });
});
