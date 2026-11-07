/** A job's pay calendar: paydays so far this year, the next one, its label. */
import { MS_PER_DAY } from "../../constants";
import { PAY_PERIOD_LABELS } from "../../config/display-labels";

/**
 * Walks `anchorPayDate` forward or backward by `intervalDays` until it lands
 * on the first payday on or after `referenceDate` (inclusive — the result
 * may equal `referenceDate` exactly). Used to align an arbitrary known
 * payday to the start of whichever year is being analyzed, before walking
 * paydays forward from there.
 *
 * NOT used by findNextPayDate, which needs the payday strictly after (not
 * on) its reference date — a different boundary, kept separate deliberately
 * rather than folded into this same helper.
 */
export function alignPaydayOnOrAfter(
  anchorPayDate: Date,
  referenceDate: Date,
  intervalDays: number,
): Date {
  const msPerDay = MS_PER_DAY;
  let payday = new Date(anchorPayDate);
  while (payday > referenceDate) {
    payday = new Date(payday.getTime() - intervalDays * msPerDay);
  }
  while (payday < referenceDate) {
    payday = new Date(payday.getTime() + intervalDays * msPerDay);
  }
  return payday;
}

/**
 * Paychecks so far this year: walked from the job's anchor payday when it
 * has one, else estimated from the month. One rule for every view that
 * pro-rates a paycheck plan (Contributions' YTD / Year-End Estimate, the
 * Dashboard's Saved This Year).
 */
export function periodsElapsedYtd(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: string | Date | null | undefined,
  periodsPerYear: number,
): number {
  return anchorPayDate
    ? countPeriodsElapsed(asOfDate, payPeriod, new Date(anchorPayDate))
    : Math.round((asOfDate.getMonth() / 12) * periodsPerYear);
}

/**
 * This year's paydays before a job started (as of `asOfDate`'s year): 0
 * for a job started before Jan 1 or with no start date. Counted on the
 * job's own pay calendar, so a check on the start date is the job's first.
 */
export function periodsBeforeStart(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: string | Date | null | undefined,
  startDate: string | Date | null | undefined,
): number {
  if (!startDate) return 0;
  const start = new Date(startDate);
  if (start.getUTCFullYear() !== asOfDate.getUTCFullYear()) return 0;
  const dayBefore = new Date(start.getTime() - MS_PER_DAY);
  if (dayBefore.getUTCFullYear() !== asOfDate.getUTCFullYear()) return 0;
  // No anchor payday: the start date is one, as the paycheck uses.
  return countPeriodsElapsed(
    dayBefore,
    payPeriod,
    new Date(anchorPayDate ?? start),
  );
}

/** Checks a job has paid so far this year: paydays so far less those
 *  before it started. What a year-to-date dollar figure multiplies by;
 *  the paydays left this year stay periodsPerYear − periodsElapsedYtd. */
export function checksPaidYtd(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: string | Date | null | undefined,
  periodsPerYear: number,
  startDate: string | Date | null | undefined,
): number {
  // No anchor payday: the start date is one, as the paycheck uses.
  const anchor = anchorPayDate ?? startDate;
  return Math.max(
    0,
    periodsElapsedYtd(asOfDate, payPeriod, anchor, periodsPerYear) -
      periodsBeforeStart(asOfDate, payPeriod, anchor, startDate),
  );
}

/** Months of contributions so far this year for a monthly schedule (a month counts from the 15th). */
export function monthsElapsedYtd(asOfDate: Date): number {
  return asOfDate.getMonth() + (asOfDate.getDate() >= 15 ? 1 : 0);
}

/**
 * Months done this year for a monthly contribution, given the day its
 * latest contribution actually arrived (YYYY-MM-DD, if known): a month
 * whose contribution has posted is done even before the 15th, so the rest
 * of the year isn't counted from a month that's already in.
 */
export function monthsDoneYtd(
  asOfDate: Date,
  latestContributionDay: string | null | undefined,
): number {
  const byDate = monthsElapsedYtd(asOfDate);
  if (!latestContributionDay) return byDate;
  const [y, m] = latestContributionDay.split("-").map(Number);
  return y === asOfDate.getFullYear() ? Math.max(byDate, m!) : byDate;
}

/**
 * The share of a year's planned amount one contribution brings, by how it's
 * made: one paycheck, one month, or none for a once-a-year amount (it
 * isn't spread over the year).
 */
export function contribStepFraction(
  method: string,
  periodsPerYear: number,
): number {
  switch (method) {
    case "fixed_monthly":
      return 1 / 12;
    case "fixed_annual":
      return 0;
    default:
      return periodsPerYear > 0 ? 1 / periodsPerYear : 0;
  }
}

/**
 * The share of this year's planned amount still to come, by how the
 * contribution is made: per paycheck (percent of salary, fixed per period)
 * by paychecks left, monthly by months left, annual not at all.
 */
export function contribRemainingFraction(
  method: string,
  p: { periodsElapsed: number; periodsPerYear: number; monthsElapsed: number },
): number {
  switch (method) {
    case "fixed_monthly":
      return (12 - p.monthsElapsed) / 12;
    case "fixed_annual":
      return 0;
    default:
      return p.periodsPerYear > 0
        ? Math.max(0, p.periodsPerYear - p.periodsElapsed) / p.periodsPerYear
        : 1;
  }
}

/**
 * Count how many pay periods have occurred between Jan 1 and asOfDate for the current year.
 * Uses the same anchor-payday walking logic as findExtraPaycheckMonths.
 */
export function countPeriodsElapsed(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: Date,
): number {
  const year = asOfDate.getUTCFullYear();
  const msPerDay = MS_PER_DAY;
  // Use UTC to avoid timezone issues with date-only strings
  const jan1 = new Date(Date.UTC(year, 0, 1));

  if (payPeriod === "biweekly") {
    let payday = alignPaydayOnOrAfter(anchorPayDate, jan1, 14);

    let count = 0;
    while (payday <= asOfDate) {
      count++;
      payday = new Date(payday.getTime() + 14 * msPerDay);
    }
    return count;
  }

  if (payPeriod === "semimonthly") {
    let count = 0;
    for (let m = 0; m <= asOfDate.getUTCMonth(); m++) {
      const first = new Date(Date.UTC(year, m, 1));
      const fifteenth = new Date(Date.UTC(year, m, 15));
      if (first <= asOfDate) count++;
      if (fifteenth <= asOfDate) count++;
    }
    return count;
  }

  if (payPeriod === "weekly") {
    let payday = alignPaydayOnOrAfter(anchorPayDate, jan1, 7);

    let count = 0;
    while (payday <= asOfDate) {
      count++;
      payday = new Date(payday.getTime() + 7 * msPerDay);
    }
    return count;
  }

  if (payPeriod === "monthly") {
    return asOfDate.getUTCMonth() + 1;
  }

  return 0;
}

/**
 * Finds the next upcoming pay date after asOfDate.
 *
 * For biweekly/weekly: walks forward from the anchor payday in the appropriate interval.
 * For semimonthly: next 1st or 15th.
 * For monthly: next 1st.
 */
export function findNextPayDate(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: Date,
): string {
  const msPerDay = MS_PER_DAY;

  if (payPeriod === "biweekly" || payPeriod === "weekly") {
    const interval = payPeriod === "biweekly" ? 14 : 7;
    let payday = new Date(anchorPayDate);
    // Walk backward past asOfDate, then forward to find first date > asOfDate.
    // Deliberately NOT alignPaydayOnOrAfter — that helper's boundary is
    // inclusive (payday may equal referenceDate); this needs the payday
    // strictly after asOfDate, so it keeps its own loop.
    while (payday > asOfDate)
      payday = new Date(payday.getTime() - interval * msPerDay);
    while (payday <= asOfDate)
      payday = new Date(payday.getTime() + interval * msPerDay);
    return payday.toISOString().slice(0, 10);
  }

  if (payPeriod === "semimonthly") {
    const y = asOfDate.getUTCFullYear();
    const m = asOfDate.getUTCMonth();
    const d = asOfDate.getUTCDate();
    // Pay dates are 1st and 15th
    if (d < 1) return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    if (d < 15) return new Date(Date.UTC(y, m, 15)).toISOString().slice(0, 10);
    // Next month's 1st
    return new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
  }

  if (payPeriod === "monthly") {
    const y = asOfDate.getUTCFullYear();
    const m = asOfDate.getUTCMonth();
    const d = asOfDate.getUTCDate();
    if (d < 1) return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    return new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
  }

  // Fallback
  return new Date(asOfDate.getTime() + 14 * msPerDay)
    .toISOString()
    .slice(0, 10);
}

/** Builds a human-readable pay frequency label including payWeek info. */
export function buildPayFrequencyLabel(
  payPeriod: string,
  payWeek: "even" | "odd" | "na",
): string {
  const base = PAY_PERIOD_LABELS[payPeriod] ?? payPeriod;
  if (payPeriod === "semimonthly") {
    return `${base} (1st & 15th)`;
  }
  if (payPeriod === "biweekly" && payWeek !== "na") {
    return `${base} (${payWeek === "even" ? "Even" : "Odd"} Weeks)`;
  }
  return base;
}
