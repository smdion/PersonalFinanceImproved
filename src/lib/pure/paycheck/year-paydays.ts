/** A job's checks in a year, and what its salary is divided by for each one. */
import { getPeriodsPerYear } from "../../config/pay-periods";
import {
  DEFAULT_SALARY_DIVISOR,
  type SalaryDivisor,
} from "../../config/enum-values";
import type { PaycheckInput } from "./paycheck.types";
import { countPeriodsElapsed } from "./pay-periods-in-year";

type PayCalendar = Pick<
  PaycheckInput,
  "asOfDate" | "payPeriod" | "anchorPayDate"
>;

/** The paydays in `asOfDate`'s year on the job's pay calendar (the year schedule's rows): a
 *  weekly or biweekly job's real paydays, walked from its anchor payday (27 biweekly, or 53
 *  weekly, in some years); the pay schedule's usual periods for the others. */
export function yearPaydays(input: PayCalendar): number {
  const { asOfDate, payPeriod, anchorPayDate } = input;
  if (payPeriod !== "biweekly" && payPeriod !== "weekly")
    return getPeriodsPerYear(payPeriod);
  const lastDay = new Date(Date.UTC(asOfDate.getUTCFullYear(), 11, 31, 12));
  return countPeriodsElapsed(lastDay, payPeriod, anchorPayDate);
}

/** What the salary is divided by for each check: the pay schedule's usual periods (the
 *  default), or the year's paydays when the Salary Profile entry says so. */
export function salaryDivisor(
  input: PayCalendar & Pick<PaycheckInput, "salaryDivisor">,
): number {
  return (input.salaryDivisor ?? DEFAULT_SALARY_DIVISOR) === "paydays"
    ? yearPaydays(input)
    : getPeriodsPerYear(input.payPeriod);
}

/** A job's year of checks as its contributions read it: the pay schedule's periods (a year of
 *  contribution money) and the salary divisor (each check's share of the salary). */
export type CheckBasis = {
  periodsPerYear: number;
  salaryDivisor: number;
  /** The year's paydays; absent: the periods (no check past them). */
  paydays?: number;
};

export function checkBasis(
  input: PayCalendar & Pick<PaycheckInput, "salaryDivisor">,
): CheckBasis {
  return {
    periodsPerYear: getPeriodsPerYear(input.payPeriod),
    salaryDivisor: salaryDivisor(input),
    paydays: yearPaydays(input),
  };
}

/** The Paycheck page's checks-a-year label: in a year with more paydays than the pay schedule's
 *  usual periods, the year's checks and what each one divides the salary by. */
export function checksPerYearLabel(
  paydays: number,
  job: { payPeriod: string; salaryDivisor?: SalaryDivisor | undefined },
): string {
  const usual = getPeriodsPerYear(job.payPeriod);
  if (paydays === usual) return `${paydays} checks/yr`;
  const divisor = job.salaryDivisor ?? DEFAULT_SALARY_DIVISOR;
  const each = divisor === "paydays" ? paydays : usual;
  return `${paydays} checks this year (salary ÷ ${each} each)`;
}
