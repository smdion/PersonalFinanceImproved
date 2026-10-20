/**
 * Annual Tax Liability Calculator
 *
 * Estimates total federal tax burden for the year. Unlike the paycheck calculator (which
 * computes per-period withholding), this computes the actual annual tax liability.
 *
 * Flow: per-person earnings → household wage AGI → Taxable Income → Federal Tax (brackets)
 *       + per-person FICA + household Additional Medicare → Total
 *
 * calculateHouseholdTax is the one path: federal on the household's combined
 * income with ONE standard deduction; Social Security per person on that
 * person's FICA wages, capped at the wage base; Medicare per person; the
 * 0.9% Additional Medicare Tax on the household's combined Medicare wages
 * above the filing status's LIABILITY threshold (reference data). Employers
 * withhold it per employee above a different, WITHHOLDING threshold — that
 * one belongs to paycheck withholding only; here it only sizes the
 * withheld-vs-owed warning.
 *
 * Known limitation: Tax-exempt interest (e.g. municipal bond interest) is not included
 * in provisional income for Social Security benefit taxation. The engine's computeTaxableSS()
 * already accepts a taxExemptInterest param (defaults to 0), but no data model exists to
 * capture projected muni bond income. If muni bond tracking is added, wire the annual
 * tax-exempt income through to computeTaxableSS() callers. Only affects retirees with
 * significant muni portfolios — underestimates SS tax liability by up to ~4% of SS income.
 *
 * Key differences from the paycheck calculator:
 *   - Uses actual annual income (not annualized per-period)
 *   - Applies standard deduction (paycheck withholding doesn't)
 *   - Includes Additional Medicare Tax (0.9% above the liability threshold)
 *   - SS wage base cap is applied to each person's annual FICA wages, not per-period
 *
 * Liability uses the standard (non-2(c)) brackets: the W-4 Step 2(c)
 * tables only shape paycheck withholding.
 */
import type { TaxBracketInput } from "./types";
import { roundToCents, safeDivide, sumBy } from "../utils/math";
import { formatCurrency } from "../utils/format";
import { sumBracketTax } from "./tax-brackets";

/** One person's earnings for the year, as the tax sees them (see computeAnnualEarnings). */
export type TaxEarnings = {
  /** Federal income-tax wages: taxable pay (incl. imputed income) less pre-tax money. */
  federalWages: number;
  /** Social Security / Medicare wages: gross less Section 125 deductions and FICA-exempt payroll contributions, plus FICA-taxable benefits. */
  ficaWages: number;
};

export type HouseholdTaxInput = {
  people: TaxEarnings[];
  /** Liability brackets (non-2(c)) with the filing status's standard deduction. */
  taxBrackets: TaxBracketInput;
  /** The filing status's Additional Medicare LIABILITY threshold
   *  (`fica_medicare_surtax_liability_<status>`). null when the tax data
   *  lacks the row — the withholding threshold is used, with a warning. */
  medicareLiabilityThreshold: number | null;
};

export type HouseholdTaxResult = {
  /** Σ federal wages: the AGI the tax is figured on (wages only — no investment income). */
  wageAgi: number;
  taxableIncome: number;
  federalTax: number;
  marginalRate: number;
  ficaSS: number;
  /** Medicare including the Additional Medicare Tax. */
  ficaMedicare: number;
  /** The Additional Medicare Tax owed (part of ficaMedicare). */
  additionalMedicare: number;
  totalTax: number;
  /** Federal income tax ÷ wage AGI — the same definition as the tax history. FICA is its own line. */
  effectiveRate: number;
  warnings: string[];
};

export function calculateHouseholdTax(
  input: HouseholdTaxInput,
): HouseholdTaxResult {
  const { people, taxBrackets } = input;
  const warnings: string[] = [];

  // ── Federal: combined income, ONE standard deduction ──
  // Itemized deductions are not modelled.
  const wageAgi = sumBy(people, (p) => p.federalWages);
  const taxableIncome = Math.max(0, wageAgi - taxBrackets.standardDeduction);
  const bracketResult = sumBracketTax(taxableIncome, taxBrackets.brackets);
  const federalTax = roundToCents(bracketResult.total);

  // ── Social Security: per person, capped at the wage base ──
  // (A person with two employers can have more withheld; the excess is a
  // credit on the return — this is the liability.)
  const ficaSS = roundToCents(
    sumBy(
      people,
      (p) =>
        Math.min(Math.max(0, p.ficaWages), taxBrackets.socialSecurityWageBase) *
        taxBrackets.socialSecurityRate,
    ),
  );

  // ── Medicare: per person, no cap; Additional Medicare on the household ──
  const medicareWages = sumBy(people, (p) => Math.max(0, p.ficaWages));
  const withholdingThreshold = taxBrackets.medicareAdditionalThreshold;
  const liabilityThreshold =
    input.medicareLiabilityThreshold ?? withholdingThreshold;
  if (input.medicareLiabilityThreshold === null) {
    warnings.push(
      `Your tax data has no Additional Medicare liability threshold for this filing status, so the ${formatCurrency(withholdingThreshold, 0)} withholding threshold is used.`,
    );
  }
  const rate = taxBrackets.medicareAdditionalRate;
  const additionalMedicare = roundToCents(
    Math.max(0, medicareWages - liabilityThreshold) * rate,
  );
  const ficaMedicare = roundToCents(
    medicareWages * taxBrackets.medicareRate + additionalMedicare,
  );

  // Employers withhold the surtax per employee above the withholding
  // threshold; Form 8959 settles the difference at filing.
  const withheld = roundToCents(
    sumBy(
      people,
      (p) => Math.max(0, p.ficaWages - withholdingThreshold) * rate,
    ),
  );
  if (additionalMedicare - withheld >= 1) {
    warnings.push(
      `Additional Medicare Tax: your household owes 0.9% on combined Medicare wages above ${formatCurrency(liabilityThreshold, 0)}, but employers only withhold it on one person's wages above ${formatCurrency(withholdingThreshold, 0)} — about ${formatCurrency(additionalMedicare - withheld, 0)} more is due when you file (Form 8959).`,
    );
  } else if (withheld - additionalMedicare >= 1) {
    warnings.push(
      `Additional Medicare Tax: employers withhold 0.9% on one person's wages above ${formatCurrency(withholdingThreshold, 0)}, but your household only owes it on combined Medicare wages above ${formatCurrency(liabilityThreshold, 0)} — about ${formatCurrency(withheld - additionalMedicare, 0)} comes back as a credit when you file (Form 8959).`,
    );
  }

  const totalTax = roundToCents(federalTax + ficaSS + ficaMedicare);
  return {
    wageAgi: roundToCents(wageAgi),
    taxableIncome: roundToCents(taxableIncome),
    federalTax,
    marginalRate: bracketResult.marginalRate,
    ficaSS,
    ficaMedicare,
    additionalMedicare,
    totalTax,
    effectiveRate: Number(safeDivide(federalTax, wageAgi) ?? 0),
    warnings,
  };
}
