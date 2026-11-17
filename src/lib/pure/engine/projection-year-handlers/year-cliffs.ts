/** The decumulation year's IRMAA and ACA cliff checks. */
import { checkAca } from "../aca-check";
import { acaHouseholdSize } from "@/lib/config/aca-tables";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import type { RepricedFlow } from "./conversion-year-reprice";
import { recordIrmaaTaxYear } from "./irmaa-lookback";
import { settleIrmaaCharge, type IrmaaCharge } from "./irmaa-charge";

/** Records this year's income; the year's IRMAA charge (the year-start one,
 *  else settled from this year's own MAGI) and the ACA cliff. */
export function yearCliffChecks(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: RepricedFlow,
  yearStartIrmaa: IrmaaCharge | undefined,
) {
  const { input } = ctx;
  const { incomeHistory, irmaaTaxYears } = state;
  const { year, personsUnder65 } = thisYear;
  const { routeWarnings } = flow.route;
  const { income } = flow.repriced;
  incomeHistory.push(income);
  const taxYear = recordIrmaaTaxYear(irmaaTaxYears, year, income);
  const irmaa = yearStartIrmaa ?? settleIrmaaCharge(ctx, thisYear, taxYear);
  routeWarnings.push(...irmaa.warnings);

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

  return { irmaa, acaStatus, acaMagiHeadroom };
}
