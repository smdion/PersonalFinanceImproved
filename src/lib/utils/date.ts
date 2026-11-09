/**
 * Get a person's age as of a given date.
 */
export function getAge(birthDate: Date, asOfDate: Date): number {
  let age = asOfDate.getFullYear() - birthDate.getFullYear();
  const monthDiff = asOfDate.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && asOfDate.getDate() < birthDate.getDate())
  ) {
    age--;
  }
  return age;
}

/**
 * Age as `year - birthYear`, the projection engine's year-granularity convention
 * (not date-precise like getAge). So `>= 59.5` first holds in the year a person
 * turns 60: a conservative reading of a mid-year threshold, not an off-by-one.
 */
export function ageInYear(birthYear: number, year: number): number {
  return year - birthYear;
}

/**
 * Whether the given date falls within the IRS prior-year contribution window
 * (January 1 through April 15). During this window, IRA and HSA contributions
 * can be designated for the prior tax year.
 */
export function isPriorYearContributionWindow(date: Date): boolean {
  const month = date.getMonth(); // 0-indexed
  const day = date.getDate();
  return month < 3 || (month === 3 && day <= 15);
}

/** The year of a YYYY-MM-DD date. `new Date(d).getFullYear()` parses it as
 *  UTC midnight, which behind UTC reads Jan 1 as the year before. */
export function calendarYear(date: string): number {
  return Number(date.slice(0, 4));
}

/**
 * Parse a bare date-only string as LOCAL midnight (as UTC it reads as the prior
 * day behind UTC); a value with a "T" time part or a Date passes through unchanged.
 */
export function parseLocalDateOnly(value: string | Date): Date {
  if (value instanceof Date) return value;
  return new Date(value.includes("T") ? value : value + "T00:00:00");
}

/** Midnight, local time, of the given date's calendar day — for calendar-day
 *  arithmetic (e.g. "how many days old is this date-only value") that must
 *  not be thrown off by the date's own time-of-day component. */
export function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * UTC calendar day (YYYY-MM-DD) of a timestamp: institutions post in UTC, so this
 * is an internal key, never compared to a local "today" (use calendarDateOf).
 */
export function utcDayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A YYYY-MM-DD day `n` days later (or earlier, for negative `n`), in UTC. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDayOf(d);
}

/** A real calendar date "YYYY-MM-DD" between 1900 and 2100 — what a
 *  stored date field accepts (a half-typed year like "0002-01-09" isn't). */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, month, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100) return false;
  const date = new Date(Date.UTC(y, month - 1, d));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === d;
}

/** A day that some year has in that month (Feb 29 counts). */
export function isMonthDay(month: number, day: number): boolean {
  return (
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    isCalendarDate(
      `2000-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    )
  );
}
