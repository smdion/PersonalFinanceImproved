/** The decumulation year's IRMAA and ACA cliff checks. */
import { yearMagi, type YearIncome } from "@/lib/pure/tax/year-income";
import type { growIrmaaBrackets } from "../bracket-growth";
import { checkHouseholdIrmaa } from "../household-irmaa";
import { checkAca } from "../post-withdrawal-optimizer";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** This year's income recorded for later lookbacks, then IRMAA from the
 *  year-N-2 MAGI (this year's for the first two) and the ACA cliff check. */
export function yearCliffChecks(
  incomeHistory: ProjectionLoopState["incomeHistory"],
  income: YearIncome,
  enableIrmaaAwareness: ProjectionContext["input"]["enableIrmaaAwareness"],
  filingStatus: ProjectionContext["input"]["filingStatus"],
  personsAge65Plus: number,
  rothConversionAmount: number,
  grownIrmaaBracketsForCheck: ReturnType<typeof growIrmaaBrackets>,
  input: ProjectionContext["input"],
  routeWarnings: string[],
  enableAcaAwareness: ProjectionContext["input"]["enableAcaAwareness"],
  householdSize: ProjectionContext["input"]["householdSize"],
  fplGrowthFactor: number,
  taxRates: ProjectionContext["input"]["decumulationDefaults"]["distributionTaxRates"],
) {
  // IRMAA: this year's income is recorded for the next years' lookbacks.
  incomeHistory.push(income);
  // IRMAA uses year N-2 MAGI per IRS rules; fall back to current year for first 2 years.
  const irmaaLookbackMagi = yearMagi(
    incomeHistory.length > 2 ? incomeHistory.at(-3)! : income,
    "irmaa",
  );
  const irmaaResult = checkHouseholdIrmaa({
    enableIrmaaAwareness,
    filingStatus,
    personsAge65Plus,
    projectedMagi: irmaaLookbackMagi,
    rothConversionAmount,
    irmaaBrackets: grownIrmaaBracketsForCheck,
  });
  const irmaaCost = irmaaResult.irmaaCost;
  const irmaaPaid = input.irmaaOnTopOfBudget === true ? irmaaCost : 0;
  routeWarnings.push(...irmaaResult.warnings);

  // ACA: everyone under 65 is the subsidy test, the same Medicare-eligibility
  // event the IRMAA check counts (AGE_RULES.medicare).
  const allPersonsUnder65 = personsAge65Plus === 0;
  const acaResult = checkAca({
    enableAcaAwareness,
    allPersonsUnder65,
    householdSize: householdSize ?? 2,
    income,
    fplGrowthFactor,
    fplByHousehold: taxRates.fplByHousehold,
  });
  const { acaSubsidyPreserved, acaMagiHeadroom } = acaResult;
  routeWarnings.push(...acaResult.warnings);

  return { irmaaCost, irmaaPaid, acaSubsidyPreserved, acaMagiHeadroom };
}
