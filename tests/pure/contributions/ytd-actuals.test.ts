import { describe, it, expect } from "vitest";
import { salaryEntry } from "../../helpers/salary-entry";
import { splitYtdActuals } from "@/lib/pure/contributions/ytd-actuals";
import type {
  SalaryActiveMap,
  SalaryProfileActiveMap,
} from "@/lib/pure/household/compensation";

// Invented household: one person, job 1 paid biweekly since 2020 at
// $130,000 under the active Salary Profile.
const AS_OF = new Date("2025-07-01T12:00:00Z");

const JOB_1 = {
  id: 1,
  personId: 1,
  payPeriod: "biweekly" as const,
  anchorPayDate: "2025-01-03",
  startDate: "2020-01-01",
};

const salaryProfile: SalaryProfileActiveMap = new Map([
  [1, salaryEntry({ salary: 130000 })],
]);
const noWhatIf: SalaryActiveMap = new Map();

function contrib(
  overrides: Partial<{
    id: number;
    isActive: boolean;
    jobId: number | null;
    performanceAccountId: number | null;
    contributionMethod: string;
    contributionValue: string | number;
    cappedValue: number;
  }>,
) {
  return {
    id: 1,
    isActive: true,
    jobId: 1,
    performanceAccountId: 10,
    contributionMethod: "percent_of_salary",
    contributionValue: "6",
    ...overrides,
  };
}

describe("splitYtdActuals", () => {
  it("splits a shared account's actuals by each row's expected YTD", () => {
    // 6% and 4% of the same salary over the same checks: 60% / 40%.
    const { contribActualMap } = splitYtdActuals(
      [
        contrib({ id: 1, contributionValue: "6" }),
        contrib({ id: 2, contributionValue: "4" }),
      ],
      [JOB_1],
      salaryProfile,
      noWhatIf,
      AS_OF,
      new Map([[10, { contributions: 5000, employerMatch: 1000 }]]),
    );
    expect(contribActualMap.get(1)).toEqual({
      contributions: 3000,
      employerMatch: 600,
    });
    expect(contribActualMap.get(2)).toEqual({
      contributions: 2000,
      employerMatch: 400,
    });
  });

  it("weighs a non-percent row by its own annual amount over the same checks", () => {
    // 6% of $130,000 = $7,800/yr = $300 a check; $100 a check fixed: 3:1.
    const { contribActualMap } = splitYtdActuals(
      [
        contrib({ id: 1, contributionValue: "6" }),
        contrib({
          id: 2,
          contributionMethod: "fixed_per_period",
          contributionValue: "100",
        }),
      ],
      [JOB_1],
      salaryProfile,
      noWhatIf,
      AS_OF,
      new Map([[10, { contributions: 4000, employerMatch: 1000 }]]),
    );
    expect(contribActualMap.get(1)).toEqual({
      contributions: 3000,
      employerMatch: 750,
    });
    expect(contribActualMap.get(2)).toEqual({
      contributions: 1000,
      employerMatch: 250,
    });
  });

  it("gives a job with no Salary Profile entry no expected YTD, not NaN", () => {
    // Job 9 has no entry in the active Salary Profile (no payPeriod):
    // it falls to the default periods a year with 0 checks elapsed, so
    // its expected YTD is $0 and the matched row takes the whole actual.
    const unmatchedJob = {
      id: 9,
      personId: 1,
      payPeriod: undefined,
      anchorPayDate: undefined,
      startDate: "2020-01-01",
    };
    const { contribActualMap } = splitYtdActuals(
      [
        contrib({ id: 1, contributionValue: "5" }),
        contrib({
          id: 2,
          jobId: 9,
          contributionMethod: "fixed_per_period",
          contributionValue: "500",
        }),
      ],
      [JOB_1, unmatchedJob],
      salaryProfile,
      noWhatIf,
      AS_OF,
      new Map([[10, { contributions: 2500, employerMatch: 500 }]]),
    );
    expect(contribActualMap.get(1)).toEqual({
      contributions: 2500,
      employerMatch: 500,
    });
    expect(contribActualMap.get(2)).toEqual({
      contributions: 0,
      employerMatch: 0,
    });
  });

  it("splits equally when every row feeding an account expects $0", () => {
    // Job 2 starts later this year: none of its checks have been paid, so
    // both its rows expect $0 YTD. The split is equal, not 0/0.
    const laterJob = {
      id: 2,
      personId: 1,
      payPeriod: "biweekly" as const,
      anchorPayDate: null,
      startDate: "2025-09-05",
    };
    const profile: SalaryProfileActiveMap = new Map([
      [2, salaryEntry({ salary: 90000 })],
    ]);
    const { contribActualMap } = splitYtdActuals(
      [
        contrib({ id: 1, jobId: 2, contributionValue: "6" }),
        contrib({
          id: 2,
          jobId: 2,
          contributionMethod: "fixed_per_period",
          contributionValue: "50",
        }),
      ],
      [laterJob],
      profile,
      noWhatIf,
      AS_OF,
      new Map([[10, { contributions: 300, employerMatch: 100 }]]),
    );
    expect(contribActualMap.get(1)).toEqual({
      contributions: 150,
      employerMatch: 50,
    });
    expect(contribActualMap.get(2)).toEqual({
      contributions: 150,
      employerMatch: 50,
    });
  });

  it("leaves out inactive rows and accounts with no actuals", () => {
    const { contribActualMap } = splitYtdActuals(
      [
        contrib({ id: 1, contributionValue: "6" }),
        contrib({ id: 2, isActive: false, contributionValue: "4" }),
        contrib({ id: 3, performanceAccountId: 11 }),
      ],
      [JOB_1],
      salaryProfile,
      noWhatIf,
      AS_OF,
      new Map([[10, { contributions: 1200, employerMatch: 0 }]]),
    );
    expect(contribActualMap.get(1)).toEqual({
      contributions: 1200,
      employerMatch: 0,
    });
    expect(contribActualMap.has(2)).toBe(false);
    expect(contribActualMap.has(3)).toBe(false);
  });
});
