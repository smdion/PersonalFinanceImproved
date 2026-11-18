/** The bonus check on the year schedule: which check pays it. */
import type { PaycheckInput } from "./paycheck.types";
import { MS_PER_DAY } from "../../constants";
import { parseLocalDateOnly, utcDayOf } from "../../utils/date";
import type { JobForPaycheckInput } from "./paycheck-input";
import {
  alignPaydayOnOrAfter,
  periodsBeforeStart,
} from "./pay-periods-in-year";
import { lastCheckThisYear, lastDayThisYear } from "./job-last-check";

/** No pay schedule (`payPeriod` null): the bonus is paid on its date. */
type BonusCalendar = Pick<
  PaycheckInput,
  "asOfDate" | "anchorPayDate" | "bonusMonth" | "bonusDayOfMonth"
> & { payPeriod: PaycheckInput["payPeriod"] | null };

/** The bonus's date in `asOfDate`'s year (no day set: the 1st); null with no month. */
function bonusDate(input: BonusCalendar): Date | null {
  if (input.bonusMonth == null) return null;
  const year = input.asOfDate.getFullYear();
  const month = input.bonusMonth - 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(input.bonusDayOfMonth ?? 1, lastDay);
  return new Date(Date.UTC(year, month, day));
}

/** The year's paydays on the job's calendar: walked from the anchor (weekly, biweekly), the 1st
 *  and the 15th (semimonthly), the 1st (monthly). */
function paydayDates(input: BonusCalendar): Date[] {
  const year = input.asOfDate.getFullYear();
  const { payPeriod } = input;
  if (payPeriod === "biweekly" || payPeriod === "weekly") {
    const step = (payPeriod === "biweekly" ? 14 : 7) * MS_PER_DAY;
    const december31 = new Date(Date.UTC(year, 11, 31));
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const out: Date[] = [];
    let payday = alignPaydayOnOrAfter(
      input.anchorPayDate,
      jan1,
      step / MS_PER_DAY,
    );
    for (; payday <= december31; payday = new Date(payday.getTime() + step))
      out.push(payday);
    return out;
  }
  const months = [...Array(12).keys()];
  if (payPeriod === "semimonthly")
    return months.flatMap((m) =>
      [1, 15].map((d) => new Date(Date.UTC(year, m, d))),
    );
  if (payPeriod === "monthly")
    return months.map((m) => new Date(Date.UTC(year, m, 1)));
  return [];
}

/**
 * A dated bonus's check and payday: the first payday on or after its date; dated past the
 * year's last payday, the last (paid after the regular checks). Null undated.
 */
export function bonusPayday(
  input: BonusCalendar,
): { check: number; payday: Date; date: Date } | null {
  const date = bonusDate(input);
  if (!date) return null;
  const paydays = paydayDates(input);
  if (paydays.length === 0) return { check: 1, payday: date, date };
  const k = paydays.findIndex((p) => utcDayOf(p) >= utcDayOf(date));
  const check = k === -1 ? paydays.length : k + 1;
  return { check, payday: paydays[check - 1]!, date };
}

type BonusJob = BonusCalendar &
  Pick<PaycheckInput, "payPeriod" | "startDate" | "endDate">;

/**
 * Where the bonus falls against the job: the check that pays it (an undated one, the last), or
 * null when it isn't this job's pay this year: dated before its start or after its last day this
 * year (dates compared), or undated for a job ending this year. Paid past the last check: on it.
 */
export function bonusCheck(input: BonusJob, bonusGross: number) {
  const none = { check: null, beforeStart: false, afterEnd: false };
  if (bonusGross <= 0) return none;
  const paid = bonusPayday(input);
  const start = input.startDate ? new Date(input.startDate) : null;
  const end = lastDayThisYear(input);
  const beforeStart =
    !!paid &&
    !!start &&
    start.getUTCFullYear() === input.asOfDate.getUTCFullYear() &&
    utcDayOf(paid.date) < utcDayOf(start);
  const afterEnd = !!end && (!paid || utcDayOf(paid.date) > utcDayOf(end));
  if (beforeStart || afterEnd) return { ...none, beforeStart, afterEnd };
  const last = lastCheckThisYear(input);
  const check = paid ? Math.min(paid.check, last) : last;
  // A job that starts after the year's last payday has no check this year to pay it on.
  const before = periodsBeforeStart(
    input.asOfDate,
    input.payPeriod,
    input.anchorPayDate,
    input.startDate,
  );
  return { ...none, check: check > before ? check : null };
}

/** The schedule's check that pays the bonus (bonusCheck), null when none does. */
export function bonusCheckNumber(input: BonusJob, bonusGross: number) {
  return bonusCheck(input, bonusGross).check;
}

/**
 * Where the bonus falls against the job's checks this year: the check a dated bonus is paid on
 * (null undated or outside the job), and whether it's dated before the job's start, after its
 * last day, or undated. Outside the job, the schedule leaves it out too.
 */
export function bonusOnSchedule(input: BonusJob, bonusGross: number) {
  const { check, beforeStart, afterEnd } = bonusCheck(input, bonusGross);
  const undated = input.bonusMonth == null && bonusGross > 0;
  return {
    bonusPeriod: undated ? null : check,
    bonusBeforeStart: beforeStart,
    bonusAfterEnd: afterEnd,
    bonusUndated: undated,
  };
}

/** The local day a job's dated bonus is paid this year (bonusPayday), for comparing with a local
 *  date (still to come, already posted); null undated. */
export function jobBonusPayday(
  job: Pick<
    JobForPaycheckInput,
    "payPeriod" | "anchorPayDate" | "startDate"
  > & {
    bonusMonth?: number | null;
    bonusDayOfMonth?: number | null;
  },
  asOfDate: Date,
): Date | null {
  const paid = bonusPayday({
    asOfDate,
    payPeriod: job.payPeriod ?? null,
    anchorPayDate: new Date(job.anchorPayDate ?? job.startDate),
    bonusMonth: job.bonusMonth ?? null,
    bonusDayOfMonth: job.bonusDayOfMonth ?? null,
  });
  return paid ? parseLocalDateOnly(utcDayOf(paid.payday)) : null;
}
