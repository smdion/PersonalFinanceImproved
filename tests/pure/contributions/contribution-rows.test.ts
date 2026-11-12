/**
 * A payroll fixed_monthly / fixed_annual account taken from the bonus check
 * needs the job's real pay-period count to know its per-paycheck amount.
 * A schedule of 0 for those methods would make the bonus share regular / 0 =
 * Infinity, and the cap pass would zero the account.
 */
import type { ContributionMethod } from "@/lib/config/enum-values";
import { describe, it, expect } from "vitest";
import {
  annualContributionWithBonus,
  type ContributionRow,
} from "@/lib/pure/contributions/contribution-rows";
import { rowPaySchedule } from "@/lib/pure/contributions/row-pay";
import { contributionRowAmounts } from "@/lib/pure/contributions/row-amounts";

const hsa = (method: ContributionMethod, value: number): ContributionRow => ({
  id: 1,
  personId: 1,
  jobId: 1,
  accountType: "hsa",
  subType: null,
  label: null,
  parentCategory: "Retirement",
  contributionMethod: method,
  contributionValue: value,
  taxTreatment: "tax_free",
  employerMatchType: "none" as const,
  employerMatchValue: null,
  employerMaxMatchPct: null,
  isPayrollDeducted: true,
  fromBonus: true,
  ownership: "individual",
});

const jobs = [{ id: 1, personId: 1, payPeriod: "biweekly" }];
const pay = [
  {
    job: { id: 1, personId: 1 },
    salary: 100_000,
    bonusGross: 10_000,
  },
];

describe("fixed-monthly / fixed-annual accounts taken from the bonus check", () => {
  it("resolves the job's real pay periods for every method", () => {
    const row = hsa("fixed_monthly", 100);
    expect(rowPaySchedule(row, jobs).periodsPerYear).toBe(26);
    expect(rowPaySchedule(row, jobs).incomplete).toBe(false);
  });

  it("a $100/month HSA gives a finite annual: 12 months plus one paycheck's share", () => {
    const { annualById } = contributionRowAmounts(
      [hsa("fixed_monthly", 100)],
      jobs,
      pay,
    );
    const annual = annualById.get(1)!;
    expect(Number.isFinite(annual)).toBe(true);
    expect(annual).toBeCloseTo(1200 + 1200 / 26, 2);
  });

  it("a fixed-annual account likewise takes one paycheck's share from the bonus", () => {
    const { annualById } = contributionRowAmounts(
      [hsa("fixed_annual", 1200)],
      jobs,
      pay,
    );
    expect(annualById.get(1)!).toBeCloseTo(1200 + 1200 / 26, 2);
  });

  it("never divides by zero when no pay period is known", () => {
    const annual = annualContributionWithBonus(
      {
        contributionMethod: "fixed_monthly" as const,
        contributionValue: 100,
        jobId: 1,
        fromBonus: true,
      },
      { salary: 100_000, bonusGross: 10_000 },
      0,
    );
    expect(annual).toBe(1200);
  });
});

// ---------------------------------------------------------------------------
// annualContributionWithBonus — the one yearly amount (the paycheck's way)
// ---------------------------------------------------------------------------

describe("annualContributionWithBonus", () => {
  const pct = (
    value: number,
    jobId: number | null = 1,
    fromBonus: boolean | undefined = true,
  ) => ({
    contributionMethod: "percent_of_salary" as const,
    contributionValue: value,
    jobId,
    fromBonus,
  });

  it("takes the rate of the base salary when the bonus check carries nothing", () => {
    expect(annualContributionWithBonus(pct(10), { salary: 100_000 }, 26)).toBe(
      10_000,
    );
  });

  it("adds the rate of the bonus once when the account is taken from bonus checks", () => {
    // The bonus is never also part of the salary, so it can't be counted twice.
    expect(
      annualContributionWithBonus(
        pct(10),
        { salary: 100_000, bonusGross: 12_000 },
        26,
      ),
    ).toBe(11_200);
  });

  it("takes a fixed per-paycheck amount once more from the bonus check", () => {
    expect(
      annualContributionWithBonus(
        {
          contributionMethod: "fixed_per_period" as const,
          contributionValue: 200,
          jobId: 1,
          fromBonus: true,
        },
        { salary: 100_000, bonusGross: 12_000 },
        26,
      ),
    ).toBe(200 * 27);
  });

  it("takes nothing from the bonus unless the account is set to (fromBonus)", () => {
    for (const fromBonus of [false, undefined]) {
      expect(
        annualContributionWithBonus(
          { ...pct(10), fromBonus },
          { salary: 100_000, bonusGross: 12_000 },
          26,
        ),
      ).toBe(10_000);
    }
  });

  it("takes nothing from the bonus for an account not paid through payroll", () => {
    expect(
      annualContributionWithBonus(
        pct(10, null),
        { salary: 100_000, bonusGross: 12_000 },
        26,
      ),
    ).toBe(10_000);
  });
});

describe("rowPaySchedule: the one schedule a row's per-check amount runs on", () => {
  const perCheck = (
    over: Partial<Parameters<typeof rowPaySchedule>[0]>,
  ): Parameters<typeof rowPaySchedule>[0] => ({
    contributionMethod: "fixed_per_period",
    jobId: null,
    personId: 1,
    ownership: "individual",
    ...over,
  });
  const twoJobs = [
    { id: 1, personId: 1, payPeriod: "biweekly" },
    { id: 2, personId: 2, payPeriod: "monthly" },
  ];

  it("a row's own job, else its person's first job", () => {
    expect(rowPaySchedule(perCheck({ jobId: 2 }), twoJobs)).toMatchObject({
      periodsPerYear: 12,
      incomplete: false,
      job: twoJobs[1],
    });
    expect(rowPaySchedule(perCheck({}), twoJobs)).toMatchObject({
      periodsPerYear: 26,
      job: twoJobs[0],
    });
  });

  it("a household joint row: the one schedule every active job pays on, else $0 flagged", () => {
    const joint = perCheck({ ownership: "joint", personId: null });
    expect(rowPaySchedule(joint, twoJobs)).toEqual({
      periodsPerYear: 0,
      incomplete: true,
      job: undefined,
    });
    expect(rowPaySchedule(joint, [twoJobs[0]!])).toMatchObject({
      periodsPerYear: 26,
      incomplete: false,
    });
    expect(rowPaySchedule(joint, []).incomplete).toBe(true);
  });

  it("a joint row tied to a job reads that job's schedule", () => {
    expect(
      rowPaySchedule(perCheck({ ownership: "joint", jobId: 2 }), twoJobs)
        .periodsPerYear,
    ).toBe(12);
  });

  it("a household joint percent is incomplete: it has no pay of its own", () => {
    const jointPercent = perCheck({
      ownership: "joint",
      personId: null,
      contributionMethod: "percent_of_salary",
    });
    expect(rowPaySchedule(jointPercent, twoJobs).incomplete).toBe(true);
    expect(
      rowPaySchedule({ ...jointPercent, jobId: 1 }, twoJobs).incomplete,
    ).toBe(false);
  });

  it("an individual row is incomplete only as a per-check amount", () => {
    expect(
      rowPaySchedule(perCheck({ contributionMethod: "fixed_monthly" }), [])
        .incomplete,
    ).toBe(false);
  });
});
