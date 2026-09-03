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
 * A person's integer age in a given calendar year — the coarse,
 * calendar-year-granularity convention the retirement projection engine
 * uses everywhere it reasons about age (it projects year-by-year, never by
 * exact date). Deliberately NOT `getAge` above, which is date-precise and
 * wants a real birth date + as-of date; this is `year - birthYear`, nothing
 * more.
 *
 * The convention this implies for age-threshold constants that aren't whole
 * numbers (e.g. `PENALTY_FREE_AGE = 59.5`) is worth stating explicitly:
 * `ageInYear(birthYear, year) >= 59.5` is only ever true when
 * `ageInYear(...) >= 60`, i.e. eligibility starts in the calendar year the
 * person turns 60, not the year they actually turn 59.5. That reads like an
 * off-by-one at first glance; it isn't — it's the correct, conservative
 * interpretation of a mid-year threshold under year-granularity modeling.
 */
export function ageInYear(birthYear: number, year: number): number {
  return year - birthYear;
}

/**
 * Whether the given date falls within the IRS prior-year contribution window
 * (January 1 through April 15). During this window, IRA and HSA contributions
 * can be designated for the prior tax year.
 */
export function isPriorYearContribWindow(date: Date = new Date()): boolean {
  const month = date.getMonth(); // 0-indexed
  const day = date.getDate();
  return month < 3 || (month === 3 && day <= 15);
}

/**
 * A calendar date (YYYY-MM-DD) in the CALLER'S OWN local timezone, not UTC.
 *
 * `date.toISOString().slice(0, 10)` — the pattern this replaces — reads the
 * date in UTC, which silently returns tomorrow's date once local time passes
 * midnight UTC (e.g. after ~7pm Eastern, ~4pm Pacific). Every "today"
 * default (a new snapshot's date, a new transaction's date, a backup
 * filename) computed this way is silently wrong for part of every day.
 *
 * Moved here from `lib/simplefin/sync.ts` — that module already
 * had this exact helper for exactly this reason ("matching the version-cron
 * convention"); centralizing it is what lets every other "today" call site
 * share the same fix instead of re-deriving it.
 */
export function localDateStr(date: Date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Parse a value that MAY be a bare date-only string ("2020-11-01") as LOCAL
 * midnight rather than UTC midnight — `new Date("2020-11-01")` (unguarded)
 * parses as UTC, which `.toLocaleDateString()`/`.getMonth()`/etc. then read
 * back as the PRIOR calendar day in any timezone behind UTC (all of the US).
 * A value that already carries a time component (has a "T", e.g. a
 * JSON-serialized full timestamp) is passed through unchanged — appending a
 * second time component would corrupt it.
 *
 * Same guard `formatDate` (`lib/utils/format.ts`) already applies inline;
 * extracted here so call sites that need the `Date` itself (not just a
 * formatted string) — comparisons, `.getFullYear()`, etc. — can share it
 * too, instead of re-deriving the guard or (worse) skipping it.
 */
export function parseLocalDateOnly(value: string | Date): Date {
  if (value instanceof Date) return value;
  return new Date(value.includes("T") ? value : value + "T00:00:00");
}

/** Midnight, local time, of the given date's calendar day — for calendar-day
 *  arithmetic (e.g. "how many days old is this date-only value") that must
 *  not be thrown off by the date's own time-of-day component. */
export function localMidnight(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
