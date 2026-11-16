// A person's age for a rule, and how many in the household meet one; the
// rules live in lib/config/age-rules.ts.
import { AGE_RULES, type AgeRuleKey } from "@/lib/config/age-rules";
import {
  ageInYear,
  calendarYear,
  getAge,
  parseLocalDateOnly,
} from "@/lib/utils/date";

/** Whether someone born in `birthYear` (and `birthMonth`, 1–12, when
 *  known) meets `rule` by Dec 31 of `year`. */
export function reachesAgeRule(
  birthYear: number,
  rule: AgeRuleKey,
  year: number,
  birthMonth?: number,
): boolean {
  const { age, measuredOn } = AGE_RULES[rule];
  if (measuredOn === "dec31") return ageInYear(birthYear, year) >= age;
  if (birthMonth == null)
    throw new Error(`reachesAgeRule: "${rule}" is measured by birth month`);
  // Whole months of age at Dec 31, counting from the birth month.
  return ageInYear(birthYear, year) * 12 + 12 - birthMonth >= age * 12;
}

/** How many people the household has: one per birth year, else one. */
export function countPeople(
  perPersonBirthYears: readonly number[] | undefined,
): number {
  return perPersonBirthYears && perPersonBirthYears.length > 0
    ? perPersonBirthYears.length
    : 1;
}

/**
 * How many people meet `rule` in `year`. Without per-person birth years,
 * the household's one representative age (already the age in `year`)
 * stands for one person.
 */
export function countReachingAgeRule(
  perPersonBirthYears: readonly number[] | undefined,
  representativeAge: number,
  rule: AgeRuleKey,
  year: number,
): number {
  if (perPersonBirthYears && perPersonBirthYears.length > 0) {
    return perPersonBirthYears.filter((by) => reachesAgeRule(by, rule, year))
      .length;
  }
  return representativeAge >= AGE_RULES[rule].age ? 1 : 0;
}

/** The age in `year` (at Dec 31) of a stored `YYYY-MM-DD` date of birth. */
export function limitAge(dateOfBirth: string, year: number): number {
  return ageInYear(calendarYear(dateOfBirth), year);
}

/** Age on `asOf` of a stored `YYYY-MM-DD` birth date, read as local
 *  midnight like `asOf`'s own calendar day. */
export function ageOnDate(dateOfBirth: string, asOf: Date): number {
  return getAge(parseLocalDateOnly(dateOfBirth), asOf);
}
