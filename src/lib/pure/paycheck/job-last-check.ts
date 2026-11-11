/** A job's last check this year: the year schedule's rows after it are empty. */
import type { PaycheckInput } from "./paycheck.types";
import { countPeriodsElapsed } from "./pay-periods-in-year";

type JobEnd = Pick<
  PaycheckInput,
  "asOfDate" | "payPeriod" | "anchorPayDate" | "endDate"
>;

/** The job's last day when it falls in the schedule's year (`asOfDate`'s), else null. */
function lastDayThisYear(input: JobEnd): Date | null {
  const end = input.endDate;
  return end && end.getUTCFullYear() === input.asOfDate.getUTCFullYear()
    ? end
    : null;
}

/**
 * The job's last check this year (as of `asOfDate`'s year): the paydays
 * through its last day when it ends this year, else the year's last check.
 */
export function lastCheckThisYear(
  input: JobEnd,
  periodsPerYear: number,
): number {
  const end = lastDayThisYear(input);
  if (!end) return periodsPerYear;
  return Math.min(
    periodsPerYear,
    countPeriodsElapsed(end, input.payPeriod, input.anchorPayDate),
  );
}

/**
 * The bonus's check is after the job's last check this year (not its pay): dated after it,
 * or undated (paid after the regular checks, maybe past the last day) for a job ending now.
 */
export function bonusAfterEnd(
  input: JobEnd & Pick<PaycheckInput, "bonusMonth">,
  bonusCheck: number,
  periodsPerYear: number,
): boolean {
  if (!lastDayThisYear(input)) return false;
  return (
    input.bonusMonth == null ||
    bonusCheck > lastCheckThisYear(input, periodsPerYear)
  );
}
