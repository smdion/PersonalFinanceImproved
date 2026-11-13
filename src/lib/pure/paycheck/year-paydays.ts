/** A job's checks in a year, and what its salary is divided by for each one. */
import { getPeriodsPerYear } from "../../config/pay-periods";
import { DEFAULT_SALARY_DIVISOR } from "../../config/enum-values";
import type { PaycheckInput } from "./paycheck.types";

type PayCalendar = Pick<
  PaycheckInput,
  "asOfDate" | "payPeriod" | "anchorPayDate"
>;

/** The paydays in `asOfDate`'s year on the job's pay calendar (the year schedule's rows):
 *  the pay schedule's usual periods (26 biweekly), every year. */
export function yearPaydays(input: PayCalendar): number {
  return getPeriodsPerYear(input.payPeriod);
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
export type CheckBasis = { periodsPerYear: number; salaryDivisor: number };

export function checkBasis(
  input: PayCalendar & Pick<PaycheckInput, "salaryDivisor">,
): CheckBasis {
  return {
    periodsPerYear: getPeriodsPerYear(input.payPeriod),
    salaryDivisor: salaryDivisor(input),
  };
}
