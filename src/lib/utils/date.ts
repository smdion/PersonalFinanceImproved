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
 * Whether the given date falls within the IRS prior-year contribution window
 * (January 1 through April 15). During this window, IRA and HSA contributions
 * can be designated for the prior tax year.
 */
export function isPriorYearContribWindow(date: Date = new Date()): boolean {
  const month = date.getMonth(); // 0-indexed
  const day = date.getDate();
  return month < 3 || (month === 3 && day <= 15);
}
