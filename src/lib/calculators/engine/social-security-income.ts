/**
 * Social Security paid in a projection year — per person from each one's
 * own start age when the input has per-person entries, else the household
 * figure from the household start age. One computation for the year
 * handler (what it pays) and the spending strategies (what it covers).
 */
import { ageInYear } from "../../utils/date";
import type { ProjectionInput } from "../types";

export function socialSecurityForYear(
  input: Pick<
    ProjectionInput,
    "socialSecurityEntries" | "socialSecurityAnnual" | "ssStartAge"
  >,
  year: number,
  age: number,
): {
  ssIncome: number;
  ssIncomeByPerson:
    { personId: number; personName: string; amount: number }[] | undefined;
} {
  if (input.socialSecurityEntries && input.socialSecurityEntries.length > 0) {
    const ssIncomeByPerson = input.socialSecurityEntries.map((entry) => ({
      personId: entry.personId,
      personName: entry.personName,
      amount:
        ageInYear(entry.birthYear, year) >= entry.startAge
          ? entry.annualAmount
          : 0,
    }));
    return {
      ssIncome: ssIncomeByPerson.reduce((sum, e) => sum + e.amount, 0),
      ssIncomeByPerson,
    };
  }
  return {
    ssIncome: age >= input.ssStartAge ? input.socialSecurityAnnual : 0,
    ssIncomeByPerson: undefined,
  };
}
