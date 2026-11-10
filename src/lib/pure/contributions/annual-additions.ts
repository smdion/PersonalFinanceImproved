/** The annual-additions limit (IRC 415(c)), applied per employer: a plan row's employer. */

/** A plan row's employer: its job, and the job's gross pay this year (null = unknown). */
export type PlanEmployer = { key: number; pay: number | null };

type JobPay = { job: { id: number }; salary: number; totalComp?: number };

/** A job's gross pay for the year: salary + bonus when known, else salary. */
export const jobPay = (js: JobPay) => js.totalComp ?? js.salary;

/** The employer of a row at `jobId` (none for a row with no job), with that job's pay. */
export function planEmployer(
  jobId: number | null,
  jobSalaries: readonly JobPay[],
): PlanEmployer | undefined {
  if (jobId === null) return undefined;
  const js = jobSalaries.find((s) => s.job.id === jobId);
  return { key: jobId, pay: js ? jobPay(js) : null };
}
