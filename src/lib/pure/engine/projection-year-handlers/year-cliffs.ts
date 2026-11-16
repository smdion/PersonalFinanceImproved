/** The decumulation year's IRMAA and ACA cliff checks. */
import { yearMagi } from "@/lib/pure/tax/year-income";
import { checkHouseholdIrmaa } from "../household-irmaa";
import { checkAca } from "../aca-check";
import { acaHouseholdSize } from "@/lib/config/aca-tables";
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
  const { personsAge65Plus, personsUnder65 } = thisYear;
  const { routeWarnings } = flow.route;
  const { income } = flow.repriced;
  incomeHistory.push(income);
  const irmaaLookbackMagi = yearMagi(
    incomeHistory.length > 2 ? incomeHistory.at(-3)! : income,
    "irmaa",
  );
  const irmaaResult = checkHouseholdIrmaa({
    filingStatus: input.filingStatus,
    personsAge65Plus,
    projectedMagi: irmaaLookbackMagi,
    rothConversionAmount: flow.conversion.rothConversionAmount,
    irmaaBrackets: thisYear.tables.grownIrmaaBracketsForCheck,
  });
  const irmaaCost = irmaaResult.irmaaCost;
  const irmaaPaid = input.irmaaOnTopOfBudget === true ? irmaaCost : 0;
  routeWarnings.push(...irmaaResult.warnings);

  // ACA: checked while anyone is under 65 (AGE_RULES.medicare, as IRMAA).
  const acaResult = checkAca({
    enableAcaAwareness: input.enableAcaAwareness,
    anyPersonUnder65: personsUnder65 > 0,
    householdSize:
      input.householdSize ??
      acaHouseholdSize(input.perPersonBirthYears?.length, input.filingStatus),
    income,
    fplGrowthFactor: thisYear.tables.fplGrowthFactor,
    fplByHousehold: thisYear.taxRates.fplByHousehold,
  });
  const { acaStatus, acaMagiHeadroom } = acaResult;
  routeWarnings.push(...acaResult.warnings);

  return { irmaaCost, irmaaPaid, acaStatus, acaMagiHeadroom };
}
