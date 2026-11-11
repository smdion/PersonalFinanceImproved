/** The IRS-limit cap pass for a request: the household's jobs and this year's pay. */
import {
  type CappedRowFields,
  type CapPassRow,
  type CapRequestHousehold,
  capEffectiveContribs,
} from "./cap-pass";
import type { JobRef } from "./contribution-rows";
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

/** Cap a request's effective rows: every job each person holds counts, paid this year's pay
 *  (IRC 219(f)(1); thisYearJobPay; a What-If salary is the current job's only, whatIfForJob). */
export function capForRequest<R extends CapPassRow>(
  rows: readonly R[],
  household: CapRequestHousehold,
  jobs: readonly (JobRef & JobLike)[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
  salaryActiveMap: SalaryActiveMap,
): (R & CappedRowFields)[] {
  // Jobs held on the request's date in its tax year, else on Dec 31.
  const asOf =
    household.taxYear === household.asOf.getFullYear()
      ? household.asOf
      : new Date(household.taxYear, 11, 31);
  const activeJobs = filterActiveJobs(jobs, asOf).filter((j) =>
    household.people.some((p) => p.id === j.personId),
  );
  return capEffectiveContribs(rows, {
    ...household,
    activeJobs,
    jobSalaries: activeJobs.map((job) => {
      const whatIf = whatIfForJob(job, jobs, asOf, salaryActiveMap);
      const pay = thisYearJobPay(job, salaryProfileActiveMap, whatIf);
      const { salary, bonusGross, totalComp } = pay;
      return { job, salary, bonusGross, totalComp };
    }),
  });
}
