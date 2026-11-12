/** The decumulation year's IRMAA and ACA cliff checks. */
import { yearMagi } from "@/lib/pure/tax/year-income";
import { checkHouseholdIrmaa } from "../household-irmaa";
import { checkAca } from "../aca-check";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import type { RepricedFlow } from "./conversion-year-reprice";

/** This year's income recorded for later lookbacks, then IRMAA from the
 *  year-N-2 MAGI (this year's for the first two) and the ACA cliff check. */
export function yearCliffChecks(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: RepricedFlow,
) {
  const { input } = ctx;
  const { incomeHistory } = state;
  const { personsAge65Plus } = thisYear;
  const { routeWarnings } = flow.route;
  const { income } = flow.repriced;
  // IRMAA: this year's income is recorded for the next years' lookbacks.
  incomeHistory.push(income);
  // IRMAA uses year N-2 MAGI per IRS rules; fall back to current year for first 2 years.
  const irmaaLookbackMagi = yearMagi(
    incomeHistory.length > 2 ? incomeHistory.at(-3)! : income,
    "irmaa",
  );
  const irmaaResult = checkHouseholdIrmaa({
    enableIrmaaAwareness: input.enableIrmaaAwareness,
    filingStatus: input.filingStatus,
    personsAge65Plus,
    projectedMagi: irmaaLookbackMagi,
    rothConversionAmount: flow.conversion.rothConversionAmount,
    irmaaBrackets: thisYear.tables.grownIrmaaBracketsForCheck,
  });
  const irmaaCost = irmaaResult.irmaaCost;
  const irmaaPaid = input.irmaaOnTopOfBudget === true ? irmaaCost : 0;
  routeWarnings.push(...irmaaResult.warnings);

  // ACA: everyone under 65 is the subsidy test, the same Medicare-eligibility
  // event the IRMAA check counts (AGE_RULES.medicare).
  const allPersonsUnder65 = personsAge65Plus === 0;
  const acaResult = checkAca({
    enableAcaAwareness: input.enableAcaAwareness,
    allPersonsUnder65,
    householdSize: input.householdSize ?? 2,
    income,
    fplGrowthFactor: thisYear.tables.fplGrowthFactor,
    fplByHousehold: thisYear.taxRates.fplByHousehold,
  });
  const { acaSubsidyPreserved, acaMagiHeadroom } = acaResult;
  routeWarnings.push(...acaResult.warnings);

  return { irmaaCost, irmaaPaid, acaSubsidyPreserved, acaMagiHeadroom };
}
