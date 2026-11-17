/** The year's IRMAA charge, settled once from the tax year its premiums read. */
import { roundToCents } from "../../../utils/math";
import { checkHouseholdIrmaa } from "../household-irmaa";
import { irmaaLookbackYear, type IrmaaTaxYear } from "./irmaa-lookback";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** A year's surcharge for every person 65+, the on-top part, and the tax
 *  year it read (an earlier one: known at the year's start); `warnings` names
 *  a conversion there that crossed a tier and, for a worked year, SSA-44. */
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
  if (taxYear.worked && irmaaCost > 0)
    warnings.push(workedYearNote(thisYear.year, taxYear, irmaaCost));
  return { cost: irmaaCost, onTop, taxYear, atYearStart, warnings };
}

/** A surcharge read from a working year's wages: stopping work is a
 *  life-changing event, so Form SSA-44 asks SSA to read a later year
 *  (20 CFR 418.1205). */
function workedYearNote(
  year: number,
  taxYear: IrmaaTaxYear,
  cost: number,
): string {
  const dollars = (n: number) => `$${Math.round(n).toLocaleString()}`;
  return `IRMAA ${year}: ${dollars(cost)} surcharge from ${taxYear.year} working-year income (${dollars(taxYear.magi)} MAGI). Stopping work is a life-changing event: file Form SSA-44 and Social Security can use your lower income instead.`;
}

/** The charge known at the year's start, from the tax year it reads.
 *  Absent until one is known; the year then settles it from its own. */
export function yearStartIrmaaCharge(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
): IrmaaCharge | undefined {
  const taxYear = irmaaLookbackYear(
    state.irmaaTaxYears,
    thisYear.year,
    ctx.input.asOfDate.getFullYear(),
  );
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
