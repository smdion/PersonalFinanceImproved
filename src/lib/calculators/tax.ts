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
 * withheld-vs-owed warning. calculateTax is the one-person form.
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
 * W-4 Step 2(c) checkbox:
 *   The checkbox indicates the employee has two jobs or a working spouse, which halves the
 *   bracket thresholds to avoid under-withholding. The tRPC layer passes the appropriate bracket
 *   set based on the job's W-4 settings, but the user can override this choice via
 *   `w4CheckboxOverride`. The result reports which option was used so the UI can display it.
 *   Note: 2(c) primarily affects paycheck withholding accuracy, not actual tax liability.
 *   For annual tax estimation, the standard (non-2c) brackets should typically be used.
 */
import type { TaxBracketInput, TaxInput, TaxResult } from "./types";
import { roundToCents, safeDivide, sumBy } from "../utils/math";
import { formatCurrency } from "../utils/format";
import { sumBracketTax } from "./tax-brackets";

/** One person's earnings for the year, as the tax sees them (see computeAnnualEarnings). */
export type TaxEarnings = {
  /** Salary + bonus. */
  gross: number;
  /** Money that comes out before federal income tax (pre-tax contributions, Section 125 deductions). */
  preTaxFederal: number;
  /** Social Security / Medicare wages: gross less Section 125 deductions and FICA-exempt payroll contributions. */
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
  /** Σ gross − Σ pre-tax: the AGI the tax is figured on (wages only — no investment income). */
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
  const wageAgi =
    sumBy(people, (p) => p.gross) - sumBy(people, (p) => p.preTaxFederal);
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

/** One person's tax — calculateHouseholdTax for a household of one. */
export function calculateTax(input: TaxInput): TaxResult {
  const { taxBrackets, w4CheckboxOverride } = input;

  // ── W-4 2(c) checkbox resolution ──
  // null = auto (use whatever bracket set the tRPC layer passed based on job settings)
  // true/false = user explicitly chose, overriding the job's W-4 setting
  const w4CheckboxUsed = w4CheckboxOverride ?? taxBrackets.w4Checkbox ?? false;
  const warnings: string[] = [];
  if (w4CheckboxOverride !== null) {
    warnings.push(
      `W-4 Step 2(c) checkbox manually ${w4CheckboxOverride ? "enabled" : "disabled"} by user`,
    );
  }

  const household = calculateHouseholdTax({
    people: [
      {
        gross: input.annualGross,
        preTaxFederal: input.preTaxDeductionsAnnual,
        ficaWages: input.ficaWagesAnnual ?? input.annualGross,
      },
    ],
    taxBrackets,
    // One person: the Single/HoH liability threshold equals the per-employee
    // withholding one; a married caller passes the liability row.
    medicareLiabilityThreshold:
      input.medicareLiabilityThreshold ??
      taxBrackets.medicareAdditionalThreshold,
  });

  return {
    agi: household.wageAgi,
    taxableIncome: household.taxableIncome,
    federalTax: household.federalTax,
    effectiveRate: household.effectiveRate,
    marginalRate: household.marginalRate,
    ficaSS: household.ficaSS,
    ficaMedicare: household.ficaMedicare,
    totalTax: household.totalTax,
    w4CheckboxUsed,
    warnings: [...warnings, ...household.warnings],
  };
}
