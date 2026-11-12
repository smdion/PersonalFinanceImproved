/** The job a person's paycheck year is figured for. */

/** A current job: the fields yearEarnings reads (its checks this year are
 *  the year schedule's, which stops at its last day). */
export type PaycheckYearJob = {
  id: number;
  employerName: string;
  startDate: string;
};
