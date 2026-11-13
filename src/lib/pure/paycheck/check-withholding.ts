/** One check's federal withholding, the IRS annualized percentage method (Pub 15-T). */
import type { PaycheckInput } from "./paycheck.types";
import { safeDivide } from "../../utils/math";
import { sumBracketTax } from "../tax/tax-brackets";

/**
 * IRS annualized bracket lookup: total annual tax, marginal rate (highest bracket touched), its
 * floor and the base withholding below it (worksheet display). Brackets tax [min, max), null = top.
 */
function lookupFederalWithholding(
  adjustedAnnualWage: number,
  brackets: { min: number; max: number | null; rate: number }[],
): {
  annualTax: number;
  marginalRate: number;
  bracketMin: number;
  baseWithholding: number;
} {
  let marginalRate = 0;
  let bracketMin = 0;

  // Highest bracket reached (>=, even with a 0 slice at the boundary), unlike sumBracketTax's
  // marginalRate: bracketMin/baseWithholding for the withholding-table display need it.
  for (let i = brackets.length - 1; i >= 0; i--) {
    const bracket = brackets[i]!;
    if (adjustedAnnualWage >= bracket.min) {
      marginalRate = bracket.rate;
      bracketMin = bracket.min;
      break;
    }
  }

  // Total tax: shared with tax.ts's annual-liability bracket walk
  const annualTax = sumBracketTax(adjustedAnnualWage, brackets).total;

  // Base withholding = total tax minus the marginal bracket's contribution
  // This matches the IRS withholding table format: "base + rate × (wage - bracket floor)"
  const baseWithholding =
    annualTax - (adjustedAnnualWage - bracketMin) * marginalRate;

  return { annualTax, marginalRate, bracketMin, baseWithholding };
}

/** A check's federal withholding on its federal taxable gross, and the marginal rate. */
export function checkWithholding(
  input: PaycheckInput,
  federalTaxableGross: number,
  periodsPerYear: number,
) {
  // Annualize for the bracket lookup, then divide back to per-period.
  // Pub 15-T Worksheet 1A line 1h: subtract the line 1g adjustment.
  const adjustedAnnualWage = Math.max(
    0,
    federalTaxableGross * periodsPerYear - input.taxBrackets.w4Adjustment,
  );
  const { annualTax, marginalRate } = lookupFederalWithholding(
    adjustedAnnualWage,
    input.taxBrackets.brackets,
  );
  // W-4 Line 4c: a flat per-check extra, added after the bracket lookup (never annualized) and
  // kept out of marginalRate, which feeds the bonus supplemental-rate path.
  const federalWithholding =
    safeDivide(annualTax, periodsPerYear, 0)! + input.additionalFedWithholding;
  return { marginalRate, federalWithholding };
}
