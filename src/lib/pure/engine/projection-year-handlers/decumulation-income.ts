/**
 * The decumulation year's income before any draw: each owner's required
 * minimum distribution (Social Security comes from socialSecurityForYear).
 */
import { roundToCents } from "../../../utils/math";
import { ageInYear } from "../../../utils/date";
import { computeRmdAmount, getRmdFactor } from "../../../config/rmd-tables";
import type { ProjectionContext, ProjectionLoopState } from "./types";
/** Each RMD owner's amount this year, with the divisor and balance behind
 *  it: per owner when accounts are tracked and someone has an RMD age. */
export function rmdIncomeByOwner(
  year: number,
  input: ProjectionContext["input"],
  ctx: ProjectionContext,
  hasIndividualAccounts: boolean,
  rmdStartAgeByPerson: ProjectionContext["rmdStartAgeByPerson"],
  priorYearEndTradByPerson: ProjectionLoopState["priorYearEndTradByPerson"],
) {
  // Each owner's RMD from their own Traditional balance and age, before
  // routing: the QCD takes part of it ahead of the tax estimate. Without
  // tracked accounts or RMD ages, the household path applies instead.
  const perOwnerRmd = hasIndividualAccounts && rmdStartAgeByPerson.size > 0;
  let perPersonRmdTotal: number | undefined;
  let rmdByPerson:
    | {
        personId: number;
        personName: string;
        amount: number;
        divisor?: number;
        priorYearEndTradBalance?: number;
        age?: number;
        shortfall?: number;
      }[]
    | undefined;
  if (perOwnerRmd) {
    rmdByPerson = [];
    let total = 0;
    for (const [personId, { startAge, birthYear }] of rmdStartAgeByPerson) {
      const personAge = ageInYear(birthYear, year);
      const personTrad = priorYearEndTradByPerson.get(personId) ?? 0;
      if (personAge >= startAge && personTrad > 0) {
        const rmdAmount = computeRmdAmount(personTrad, personAge);
        if (rmdAmount != null) {
          rmdByPerson.push({
            personId,
            personName:
              input.socialSecurityEntries?.find((e) => e.personId === personId)
                ?.personName ??
              ctx.indAccounts.find((a) => a.ownerPersonId === personId)
                ?.ownerName ??
              "Account owner",
            amount: rmdAmount,
            // The Uniform Lifetime Table divisor and the prior-year-end
            // balance behind `amount`, so the UI shows the working, never
            // re-derives it.
            divisor: getRmdFactor(personAge) ?? undefined,
            priorYearEndTradBalance: personTrad,
            age: personAge,
          });
          total += rmdAmount;
        }
      }
    }
    if (total > 0) perPersonRmdTotal = roundToCents(total);
  }

  return { perOwnerRmd, perPersonRmdTotal, rmdByPerson };
}
