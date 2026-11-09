/** The job a person's paycheck year is figured for. */
import type { SalaryEntry } from "@/lib/db/salary-entry-defaults";

/** A current job with its Salary Profile's pay schedule merged on
 *  (mergeSalaryProfileJobFields): the fields yearEarnings reads. */
export type PaycheckYearJob = {
  id: number;
  employerName: string;
  startDate: string;
  endDate: string | null;
  payPeriod: SalaryEntry["payPeriod"] | undefined;
  anchorPayDate: SalaryEntry["anchorPayDate"] | undefined;
};
