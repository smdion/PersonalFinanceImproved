// A person's age for a rule, and how many in the household meet one; the
// rules live in lib/config/age-rules.ts.
import { AGE_RULES, type AgeRuleKey } from "@/lib/config/age-rules";
import { ageInYear } from "@/lib/utils/date";

/** Whether someone born in `birthYear` meets `rule` in `year`. */
export function reachesAgeRule(
  birthYear: number,
  rule: AgeRuleKey,
  year: number,
): boolean {
  return ageInYear(birthYear, year) >= AGE_RULES[rule].age;
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
