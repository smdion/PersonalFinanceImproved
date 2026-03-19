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
