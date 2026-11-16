/** The year's IRMAA charge, settled once from the tax year its premiums read. */
import { checkHouseholdIrmaa } from "../household-irmaa";
import { irmaaLookbackYear, type IrmaaTaxYear } from "./irmaa-lookback";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** A year's surcharge for every person 65+, the part paid on top of the
 *  budget, and the tax year it read; `warnings` names a conversion in that
 *  year that crossed a tier. */
export type IrmaaCharge = {
  cost: number;
  onTop: number;
  taxYear: IrmaaTaxYear;
  warnings: string[];
};

/** The charge that reads `taxYear`'s MAGI. */
export function settleIrmaaCharge(
  ctx: ProjectionContext,
  thisYear: DecumulationYear,
  taxYear: IrmaaTaxYear,
): IrmaaCharge {
  const { input } = ctx;
  const { irmaaCost, warnings } = checkHouseholdIrmaa({
    filingStatus: input.filingStatus,
    personsAge65Plus: thisYear.personsAge65Plus,
    projectedMagi: taxYear.magi,
    magiTaxYear: taxYear.year,
    rothConversionAmount: taxYear.rothConversion,
    irmaaBrackets: thisYear.tables.grownIrmaaBracketsForCheck,
  });
  const onTop = input.irmaaOnTopOfBudget === true ? irmaaCost : 0;
  return { cost: irmaaCost, onTop, taxYear, warnings };
}

/** The charge known at the year's start: its tax year (year − 2) is
 *  recorded. Absent until then; the year then settles it from its own. */
export function yearStartIrmaaCharge(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
): IrmaaCharge | undefined {
  const taxYear = irmaaLookbackYear(state.irmaaTaxYears, thisYear.year);
  return taxYear && settleIrmaaCharge(ctx, thisYear, taxYear);
}

/** What of the charge a need-sized year's need holds: the on-top part once
 *  it is known at the year's start; a withdrawal-sized year's need is what
 *  its withdrawal delivers, so none. */
export function irmaaInNeed(
  charge: IrmaaCharge | undefined,
  state: { portfolioWithdrawal: number | null },
): number {
  return charge && state.portfolioWithdrawal === null ? charge.onTop : 0;
}
