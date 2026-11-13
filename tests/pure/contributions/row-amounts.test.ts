import { describe, expect, it } from "vitest";
import type { ContributionMethod } from "@/lib/config/enum-values";
import {
  jointRowAmounts,
  jointRows,
  rowAnnualContribution,
} from "@/lib/pure/contributions/row-amounts";
import { rowPaySchedule } from "@/lib/pure/contributions/row-pay";
import { filterActiveJobs, findActiveJob } from "@/lib/pure/household/profiles";

const job = (id: number, personId: number, payPeriod: string) => ({
  id,
  personId,
  payPeriod,
  startDate: "2020-01-01",
  endDate: null,
  isSpeculative: false,
});
const row = (
  id: number,
  contributionMethod: ContributionMethod,
  contributionValue: number,
  extra: { jobId?: number; isActive?: boolean } = {},
) => ({
  id,
  personId: null,
  jobId: extra.jobId ?? null,
  ownership: "joint" as const,
  employerMatchType: "none",
  contributionMethod,
  contributionValue,
  fromBonus: undefined,
  isActive: extra.isActive ?? true,
});
const asOf = new Date(2026, 2, 7);
const biweekly = [job(1, 1, "biweekly"), job(2, 2, "biweekly")];

describe("jointRows: the household's joint rows with their yearly and monthly money", () => {
  it("reads each method through the one per-row amount, the monthly in cents", () => {
    const rows = [
      row(1, "fixed_annual", 6500),
      row(2, "fixed_monthly", 300.1),
      row(3, "fixed_per_period", 100),
    ];
    const amounts = jointRowAmounts(rows, biweekly, asOf);
    expect(amounts.map((r) => [r.annual, r.periodsPerYear])).toEqual([
      [6500, 26],
      [300.1 * 12, 26],
      [2600, 26],
    ]);
    expect(
      jointRows(rows, biweekly, asOf).map((r) => [r.monthly, r.incomplete]),
    ).toEqual([
      [541.67, false],
      [300.1, false],
      [216.67, false],
    ]);
  });

  it("a per-check amount with no one schedule, or a percent, is $0 and incomplete", () => {
    const rows = jointRows(
      [row(1, "fixed_per_period", 100), row(2, "percent_of_salary", 6)],
      [job(1, 1, "biweekly"), job(2, 2, "monthly")],
      asOf,
    );
    expect(rows.map((r) => [r.monthly, r.incomplete])).toEqual([
      [0, true],
      [0, true],
    ]);
  });

  it("leaves out a joint row tied to a job and a row switched off", () => {
    const rows = jointRows(
      [
        row(1, "fixed_monthly", 100, { jobId: 1 }),
        row(2, "fixed_monthly", 100, { isActive: false }),
        row(3, "fixed_monthly", 100),
      ],
      biweekly,
      asOf,
    );
    expect(rows.map((r) => r.id)).toEqual([3]);
  });
});

describe("one person's job: the job Paycheck shows (findActiveJob)", () => {
  // Two current jobs, rows arriving with the later-started first: Paycheck
  // shows the one started first (findActiveJob), so a row with no job of
  // its own reads that one's schedule and pay, not the first row's.
  const later = { ...job(1, 1, "monthly"), startDate: "2024-06-01" };
  const earlier = { ...job(2, 1, "biweekly"), startDate: "2021-03-01" };
  const jobs = filterActiveJobs([later, earlier], asOf);
  const personRow = {
    ...row(9, "percent_of_salary", 10),
    personId: 1,
    ownership: "individual" as const,
  };
  const jobSalaries = jobs.map((j) => ({
    job: j,
    salary: j.id === 2 ? 100_000 : 40_000,
  }));

  it("the person's job is findActiveJob's for the schedule and the pay", () => {
    expect(findActiveJob([later, earlier], 1, asOf)?.id).toBe(2);
    const amount = rowAnnualContribution(personRow, jobs, jobSalaries);
    expect([amount.periodsPerYear, amount.salary, amount.annual]).toEqual([
      26, 100_000, 10_000,
    ]);
    expect(rowPaySchedule(personRow, jobs).job?.id).toBe(2);
  });

  it("the same whatever order the rows arrive in", () => {
    const flipped = filterActiveJobs([earlier, later], asOf);
    expect(flipped.map((j) => j.id)).toEqual(jobs.map((j) => j.id));
  });
});
