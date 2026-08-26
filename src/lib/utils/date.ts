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
