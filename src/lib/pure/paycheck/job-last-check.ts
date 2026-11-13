/** A job's checks this year: the year schedule's rows before its start and after its last check are empty. */
import type { PaycheckInput } from "./paycheck.types";
import { countPeriodsElapsed, periodsBeforeStart } from "./pay-periods-in-year";
import { yearPaydays } from "./year-paydays";

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
export function lastCheckThisYear(input: JobEnd): number {
  const paydays = yearPaydays(input);
  const end = lastDayThisYear(input);
  if (!end) return paydays;
  return Math.min(
    paydays,
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
): boolean {
  if (!lastDayThisYear(input)) return false;
  return input.bonusMonth == null || bonusCheck > lastCheckThisYear(input);
}

/** A job's checks in `asOfDate`'s year: the paydays before its start, its last check and the
 *  checks it pays this year (`total`); counted up to `lastAllowed` when given (the cap pass's
 *  year is the pay schedule's periods). */
export function jobChecksThisYear(
  input: JobEnd & Pick<PaycheckInput, "startDate">,
  lastAllowed = Infinity,
) {
  const beforeStart = periodsBeforeStart(
    input.asOfDate,
    input.payPeriod,
    input.anchorPayDate,
    input.startDate,
  );
  const lastCheck = Math.min(lastCheckThisYear(input), lastAllowed);
  return {
    beforeStart,
    lastCheck,
    total: Math.max(0, lastCheck - beforeStart),
  };
}

export type JobChecks = ReturnType<typeof jobChecksThisYear>;
