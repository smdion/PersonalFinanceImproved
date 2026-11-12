/** The decumulation year's tax tables, grown to the year. */
import {
  growIrmaaBrackets,
  growLtcgBrackets,
  growWithholdingBrackets,
  taxTableYears,
} from "../bracket-growth";
import { yearStandardDeduction } from "./year-deduction";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** The year's tax tables, each grown from its own table year: brackets, the
 *  standard deduction, LTCG and IRMAA brackets, and the ACA cliff's factor. */
export function growYearTaxTables(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  year: number,
  age: number,
) {
  const taxRates = ctx.input.decumulationDefaults.distributionTaxRates;
  // Brackets and the standard deduction are inflation-indexed, so each grows
  // from its own table year (taxTableYears; bracket-growth.ts says why NIIT
  // and Social Security thresholds stay flat).
  const tableYears = taxTableYears(taxRates);
  const taxGrowth = ctx.inflation.growthSinceVintage(
    year,
    tableYears.standardDeduction,
  );
  const bracketGrowth = ctx.inflation.growthSinceVintage(
    year,
    tableYears.brackets,
  );
  const grownTaxBrackets = taxRates.taxBrackets
    ? growWithholdingBrackets(taxRates.taxBrackets, bracketGrowth)
    : undefined;
  const { grownStandardDeduction } = yearStandardDeduction(
    ctx.input.perPersonBirthYears,
    year,
    age,
    taxRates,
    state.incomeHistory,
    taxGrowth,
  );
  // LTCG brackets, grown from their own year.
  const grownLtcgBrackets = growLtcgBrackets(
    taxRates.ltcgBrackets,
    ctx.inflation.growthSinceVintage(year, tableYears.ltcg),
  );

  // IRMAA brackets, two factors: this year's (the surcharge checked now) and
  // year + 2's (the conversion cap: this year's MAGI sets the premium two
  // years on).
  const irmaaGrowthCheck = ctx.inflation.growthSinceVintage(
    year,
    tableYears.irmaa,
  );
  const irmaaGrowthCap = ctx.inflation.growthSinceVintage(
    year,
    tableYears.irmaa,
    2,
  );
  const grownIrmaaBracketsForCheck = growIrmaaBrackets(
    taxRates.irmaaBrackets,
    irmaaGrowthCheck,
  );
  const grownIrmaaBracketsForCap = growIrmaaBrackets(
    taxRates.irmaaBrackets,
    irmaaGrowthCap,
  );

  // The ACA cliff (400% FPL) from its coverage year: one factor, since the
  // credit reads the coverage year's own income, no lookback.
  const fplGrowthFactor = ctx.inflation.growthSinceVintage(
    year,
    tableYears.fpl,
  );

  return {
    grownTaxBrackets,
    grownStandardDeduction,
    grownLtcgBrackets,
    grownIrmaaBracketsForCheck,
    grownIrmaaBracketsForCap,
    fplGrowthFactor,
  };
}
