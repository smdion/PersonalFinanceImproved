/** The decumulation year's IRMAA and ACA cliff checks. */
import { checkHouseholdIrmaa } from "../household-irmaa";
import { checkAca } from "../aca-check";
import { acaHouseholdSize } from "@/lib/config/aca-tables";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import type { RepricedFlow } from "./conversion-year-reprice";
import { irmaaTaxYearFor } from "./irmaa-lookback";

/** Records this year's income, then IRMAA from year N−2's MAGI and the ACA cliff. */
export function yearCliffChecks(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: RepricedFlow,
) {
  const { input } = ctx;
  const { incomeHistory, irmaaTaxYears } = state;
  const { year, personsAge65Plus, personsUnder65 } = thisYear;
  const { routeWarnings } = flow.route;
  const { income } = flow.repriced;
  incomeHistory.push(income);
  const lookback = irmaaTaxYearFor(irmaaTaxYears, year, income);
  const irmaaResult = checkHouseholdIrmaa({
    filingStatus: input.filingStatus,
    personsAge65Plus,
    projectedMagi: lookback.magi,
    magiTaxYear: lookback.year,
    rothConversionAmount: lookback.rothConversion,
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
