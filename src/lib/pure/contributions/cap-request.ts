/** The IRS-limit cap pass for a request: the household's jobs and this year's pay. */
import {
  type CappedRowFields,
  type CapPassRow,
  type CapRequestHousehold,
  capEffectiveContribs,
} from "./cap-pass";
import type { JobRef } from "./contribution-rows";
import type { CapJobPay, CapPassPerson } from "./this-year-amounts";
import { WHOLE_YEAR } from "./already-in";
import {
  categoriesWithIrsLimit,
  getAccountTypeConfig,
} from "@/lib/config/account-types";
import { getPeriodsPerYear } from "@/lib/config/pay-periods";
import { calendarDateOf } from "@/lib/utils/calendar-date";
import {
  type JobLike,
  filterActiveJobs,
  whatIfForJob,
} from "@/lib/pure/household/profiles";
import {
  type SalaryProfileActiveMap,
  type SalaryActiveMap,
  thisYearJobPay,
} from "@/lib/pure/household/compensation";
import {
  type JobForPaycheckInput,
  jobScheduleDates,
} from "@/lib/pure/paycheck/paycheck-input";
import { jobChecksThisYear } from "@/lib/pure/paycheck/job-last-check";
import { bonusCheckNumber } from "@/lib/pure/paycheck/bonus-check";

/** A job as the request's cap pass reads it: its dates, pay schedule and bonus date. */
export type CapJob = JobRef &
  JobLike &
  Pick<
    JobForPaycheckInput,
    "payPeriod" | "anchorPayDate" | "bonusMonth" | "bonusDayOfMonth"
  >;

/** A job's pay over a year: salary, its bonus and the two together. */
type JobYearPay = CapJobPay & { bonusGross: number; totalComp: number };

const dayOf = (date: string | Date) =>
  typeof date === "string" ? date.slice(0, 10) : calendarDateOf(date);

/**
 * The months a person's HSA rows cover in the tax year (IRC 223(b)(2)), as a mask: every month
 * when one has no job or its job is held on Dec 1 (the last-month rule, 223(b)(8)), else the
 * months whose 1st falls inside an HSA row's job.
 */
function coveredMonths(
  rows: readonly CapPassRow[],
  jobs: readonly CapJob[],
  personId: number,
  taxYear: number,
): number {
  let mask = 0;
  let hasHsa = false;
  for (const r of rows) {
    const type = categoriesWithIrsLimit().find((c) => c === r.accountType);
    if (r.personId !== personId || !type) continue;
    if (!getAccountTypeConfig(type).irsLimitKeys?.coverageVariant) continue;
    hasHsa = true;
    const job = jobs.find((j) => j.id === r.jobId);
    if (r.jobId === null) return WHOLE_YEAR;
    if (!job) continue;
    for (let m = 0; m < 12; m++) {
      const first = `${taxYear}-${String(m + 1).padStart(2, "0")}-01`;
      if (
        dayOf(job.startDate) <= first &&
        (!job.endDate || dayOf(job.endDate) >= first)
      )
        mask |= 1 << m;
    }
  }
  return !hasHsa || mask & (1 << 11) ? WHOLE_YEAR : mask;
}

/** The pass's this-year input (415(c), 219: this year's pay, Reg. 1.415(c)-2(e)): every job held in
 *  the tax year, current ones first, with the share of a year's checks it pays, its bonus only on
 *  one of its checks and whether it ended before `asOf`; and each person's HSA months. */
function thisYearInput(
  rows: readonly CapPassRow[],
  household: CapRequestHousehold,
  jobs: readonly CapJob[],
  asOf: Date,
  activeJobs: readonly CapJob[],
  payOf: (job: CapJob) => JobYearPay,
) {
  const { taxYear } = household;
  const held = jobs.filter(
    (j) =>
      !j.isSpeculative &&
      household.people.some((p) => p.id === j.personId) &&
      dayOf(j.startDate) <= `${taxYear}-12-31` &&
      (!j.endDate || dayOf(j.endDate) >= `${taxYear}-01-01`),
  );
  const ordered = [
    ...activeJobs,
    ...held.filter((j) => !activeJobs.includes(j)),
  ];
  const jobSalaries = ordered.map((job): CapJobPay => {
    const pay = payOf(job);
    if (!job.payPeriod) return pay;
    const input = {
      asOfDate: asOf,
      payPeriod: job.payPeriod,
      bonusMonth: job.bonusMonth ?? null,
      bonusDayOfMonth: job.bonusDayOfMonth ?? null,
      ...jobScheduleDates(job),
    };
    const periods = getPeriodsPerYear(job.payPeriod);
    const checks = jobChecksThisYear(input, periods);
    const check = bonusCheckNumber(input, pay.bonusGross);
    const bonusGross =
      check !== null && check > checks.beforeStart ? pay.bonusGross : 0;
    const share = checks.total / periods;
    return {
      ...pay,
      bonusGross,
      share,
      totalComp:
        pay.totalComp -
        pay.salary * (1 - share) -
        (pay.bonusGross - bonusGross),
      ...(job.endDate && dayOf(job.endDate) < dayOf(asOf)
        ? { ended: true as const }
        : {}),
    };
  });
  const people = household.people.map((p): CapPassPerson => {
    const months = coveredMonths(rows, ordered, p.id, taxYear);
    return months === WHOLE_YEAR ? p : { ...p, coveredMonths: months };
  });
  return { activeJobs: ordered, jobSalaries, people };
}

/** The request's jobs held on its date in its tax year (else on Dec 31) and each job's pay. */
function requestJobs(
  household: CapRequestHousehold,
  jobs: readonly CapJob[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
  salaryActiveMap: SalaryActiveMap,
) {
  const asOf =
    household.taxYear === household.asOf.getFullYear()
      ? household.asOf
      : new Date(household.taxYear, 11, 31);
  const activeJobs = filterActiveJobs(jobs, asOf).filter((j) =>
    household.people.some((p) => p.id === j.personId),
  );
  const payOf = (job: CapJob): JobYearPay => {
    const whatIf = whatIfForJob(job, jobs, asOf, salaryActiveMap);
    const pay = thisYearJobPay(job, salaryProfileActiveMap, whatIf);
    const { salary, bonusGross, totalComp } = pay;
    return { job, salary, bonusGross, totalComp };
  };
  return { asOf, activeJobs, payOf };
}

/** Cap a request's effective rows on a year's pay at the jobs held on its date (the rate a year of
 *  checks pays): every job each person holds counts (IRC 219(f)(1)); a What-If salary is the current job's only. */
export function capAtYearRate<R extends CapPassRow>(
  rows: readonly R[],
  household: CapRequestHousehold,
  jobs: readonly CapJob[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
  salaryActiveMap: SalaryActiveMap,
): (R & CappedRowFields)[] {
  const { activeJobs, payOf } = requestJobs(
    household,
    jobs,
    salaryProfileActiveMap,
    salaryActiveMap,
  );
  return capEffectiveContribs(rows, {
    ...household,
    activeJobs,
    jobSalaries: activeJobs.map(payOf),
  });
}

/** Cap a request's effective rows on this tax year's checks at every job held in it (thisYearInput):
 *  what every figure of the request reads. */
export function capForRequest<R extends CapPassRow>(
  ...request: Parameters<typeof capAtYearRate<R>>
): (R & CappedRowFields)[] {
  const [rows, household, jobs, salaryProfiles, whatIf] = request;
  const { asOf, activeJobs, payOf } = requestJobs(
    household,
    jobs,
    salaryProfiles,
    whatIf,
  );
  return capEffectiveContribs(rows, {
    ...household,
    ...thisYearInput(rows, household, jobs, asOf, activeJobs, payOf),
  });
}

const overOf = (cap: CappedRowFields["cap"]) => (cap ? cap.overBy : 0);

/** The rows for a save check: each as the pass that leaves it further over (a year's pay, or this
 *  tax year's checks), so a save over in either is refused. */
export function capForSaveCheck<R extends CapPassRow>(
  ...request: Parameters<typeof capAtYearRate<R>>
) {
  const thisYear = capForRequest(...request);
  // Both passes keep the rows' order, so row k is the same row in each.
  return capAtYearRate(...request).map((c, k) =>
    overOf(thisYear[k]!.cap) > overOf(c.cap) ? thisYear[k]! : c,
  );
}
