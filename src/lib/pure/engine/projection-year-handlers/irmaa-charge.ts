/** The year's IRMAA charge, settled once from the tax year its premiums read. */
import { roundToCents } from "../../../utils/math";
import { checkHouseholdIrmaa } from "../household-irmaa";
import { irmaaLookbackYear, type IrmaaTaxYear } from "./irmaa-lookback";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** A year's surcharge for every person 65+, the part charged on top of the
 *  budget, and the tax year it read (an earlier one: known at the year's
 *  start); `warnings` names a conversion in that year that crossed a tier. */
export type IrmaaCharge = {
  cost: number;
  onTop: number;
  taxYear: IrmaaTaxYear;
  atYearStart: boolean;
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
  const atYearStart = taxYear.year < thisYear.year;
  return { cost: irmaaCost, onTop, taxYear, atYearStart, warnings };
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
  return charge?.atYearStart && state.portfolioWithdrawal === null
    ? charge.onTop
    : 0;
}

/** What the year pays of its on-top charge from what it has to spend (what
 *  it delivered, less RMD money reinvested, plus Social Security), and the
 *  unpaid rest: unmet need, unless the need already holds it. */
export function payIrmaaCharge(
  charge: IrmaaCharge,
  state: { portfolioWithdrawal: number | null },
  thisYear: Pick<DecumulationYear, "config" | "ssIncome">,
  year: { deliveredAfterTax: number; rmdExcessAmount: number },
) {
  const reinvested =
    thisYear.config.rmdExcessHandling === "reinvest" ? year.rmdExcessAmount : 0;
  const spendable = year.deliveredAfterTax - reinvested + thisYear.ssIncome;
  const paid = Math.min(charge.onTop, Math.max(0, spendable));
  const inNeed = irmaaInNeed(charge, state) > 0;
  const unpaid = inNeed ? 0 : roundToCents(charge.onTop - paid);
  return { paid, unpaid, reinvested };
}
