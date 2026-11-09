/**
 * Social Security paid in a projection year: per person from each start age, else the household
 * figure. Entered in today's dollars and grown with general inflation (a trial's `inflationRate`),
 * so in today's dollars a benefit stays as entered.
 */
import { ageInYear } from "../../utils/date";
import { roundToCents } from "../../utils/math";
import type { ProjectionInput } from "./types/projection-result";

export function socialSecurityForYear(
  input: Pick<
    ProjectionInput,
    "socialSecurityEntries" | "socialSecurityAnnual" | "ssStartAge" | "asOfDate"
  >,
  year: number,
  age: number,
  /** Price level this year against the input's year (ctx.inflation). */
  ssGrowthFactor: number,
): {
  /** Paid this year, nominal. */
  ssIncome: number;
  /** The same benefits in today's dollars, as entered. */
  ssIncomeToday: number;
  /** This year's growth since the input's year (`ssIncome` / `ssIncomeToday`). */
  ssGrowthFactor: number;
  ssIncomeByPerson:
    { personId: number; personName: string; amount: number }[] | undefined;
} {
  const grown = (today: number) => roundToCents(today * ssGrowthFactor);
  if (input.socialSecurityEntries && input.socialSecurityEntries.length > 0) {
    const today = input.socialSecurityEntries.map((entry) =>
      ageInYear(entry.birthYear, year) >= entry.startAge
        ? entry.annualAmount
        : 0,
    );
    const ssIncomeByPerson = input.socialSecurityEntries.map((entry, i) => ({
      personId: entry.personId,
      personName: entry.personName,
      amount: grown(today[i]!),
    }));
    return {
      ssIncome: ssIncomeByPerson.reduce((sum, e) => sum + e.amount, 0),
      ssIncomeToday: today.reduce((sum, a) => sum + a, 0),
      ssGrowthFactor,
      ssIncomeByPerson,
    };
  }
  const ssIncomeToday =
    age >= input.ssStartAge ? input.socialSecurityAnnual : 0;
  return {
    ssIncome: grown(ssIncomeToday),
    ssIncomeToday,
    ssGrowthFactor,
    ssIncomeByPerson: undefined,
  };
}
