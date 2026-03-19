/**
 * Annual Tax Liability Calculator
 *
 * Estimates total federal tax burden for the year. Unlike the paycheck calculator (which
 * computes per-period withholding), this computes the actual annual tax liability.
 *
 * Flow: Annual Gross → AGI → Taxable Income → Federal Tax (brackets) → FICA → Total
 *
 * Known limitation: Tax-exempt interest (e.g. municipal bond interest) is not included
 * in provisional income for Social Security benefit taxation. Retirees with significant
 * muni bond portfolios may see underestimated SS tax liability. (Review item M9)
 *
 * Key differences from the paycheck calculator:
 *   - Uses actual annual income (not annualized per-period)
 *   - Applies standard deduction (paycheck withholding doesn't)
 *   - Includes Additional Medicare Tax (0.9% above threshold — not withheld per-paycheck)
 *   - SS wage base cap is applied to total annual gross, not per-period
 *
 * W-4 Step 2(c) checkbox:
 *   The checkbox indicates the employee has two jobs or a working spouse, which halves the
 *   bracket thresholds to avoid under-withholding. The tRPC layer passes the appropriate bracket
 *   set based on the job's W-4 settings, but the user can override this choice via
 *   `w4CheckboxOverride`. The result reports which option was used so the UI can display it.
 *   Note: 2(c) primarily affects paycheck withholding accuracy, not actual tax liability.
 *   For annual tax estimation, the standard (non-2c) brackets should typically be used.
 */
import type { TaxInput, TaxResult } from "./types";
import { roundToCents, safeDivide } from "../utils/math";

export function calculateTax(input: TaxInput): TaxResult {
  const warnings: string[] = [];

  const {
    annualGross,
    preTaxDeductionsAnnual,
    taxBrackets,
    w4CheckboxOverride,
  } = input;

  // ── W-4 2(c) checkbox resolution ──
  // null = auto (use whatever bracket set the tRPC layer passed based on job settings)
  // true/false = user explicitly chose, overriding the job's W-4 setting
  const w4CheckboxUsed = w4CheckboxOverride ?? taxBrackets.w4Checkbox ?? false;
  if (w4CheckboxOverride !== null) {
    warnings.push(
      `W-4 Step 2(c) checkbox manually ${w4CheckboxOverride ? "enabled" : "disabled"} by user`,
    );
  }

  // ── Step 1: Adjusted Gross Income → Taxable Income ──
  // AGI = gross minus pre-tax deductions (401k, HSA, health insurance, etc.)
  // Taxable income = AGI minus standard deduction (itemized deductions not yet implemented)
  const agi = annualGross - preTaxDeductionsAnnual;
  const taxableIncome = Math.max(0, agi - taxBrackets.standardDeduction);

  // ── Step 2: Federal income tax via progressive bracket walk ──
  // Walk brackets bottom-to-top, taxing each slice at its bracket rate.
  // The marginal rate is the rate of the highest bracket the income reaches.
  let federalTax = 0;
  let marginalRate = 0;

  for (const bracket of taxBrackets.brackets) {
    if (taxableIncome < bracket.min) break;

    const upper =
      bracket.max !== null
        ? Math.min(taxableIncome, bracket.max)
        : taxableIncome;
    const taxableInBracket = upper - bracket.min;
    if (taxableInBracket > 0) {
      federalTax += taxableInBracket * bracket.rate;
      marginalRate = bracket.rate;
    }
  }

  federalTax = roundToCents(federalTax);

  // ── Step 3: FICA Social Security ──
  // Employee pays 6.2% (from input) on gross income up to the wage base cap (e.g. $176,100).
  // Income above the cap is not subject to SS tax.
  const ssBase = Math.min(annualGross, taxBrackets.socialSecurityWageBase);
  const ficaSS = roundToCents(ssBase * taxBrackets.socialSecurityRate);

  // ── Step 4: FICA Medicare ──
  // Base Medicare: 1.45% (from input) on ALL gross income (no cap).
  //
  // Additional Medicare Tax (0.9% surtax) — two different thresholds apply:
  //
  //   1. WITHHOLDING threshold: $200,000 per person, regardless of filing status.
  //      Employers must withhold on the individual employee's wages above $200k.
  //      This is the threshold used in this calculator (medicareAdditionalThreshold).
  //
  //   2. LIABILITY threshold (determined on tax return): varies by filing status.
  //      - MFJ: $250,000 combined household income
  //      - MFS: $125,000
  //      - Single/HoH: $200,000
  //
  //   Because withholding and liability use different thresholds for MFJ filers,
  //   the amount withheld may not match the actual liability:
  //     - If each spouse earns $150k ($300k combined > $250k MFJ threshold),
  //       neither employer withholds the surtax, but the couple OWES it on their return.
  //     - If one spouse earns $210k but combined income is under $250k,
  //       the employer withholds the surtax, but the couple can claim a CREDIT on their return.
  //   Reconciliation happens on Form 8959 at filing time.
  let ficaMedicare = annualGross * taxBrackets.medicareRate;
  const additionalMedicareApplies =
    annualGross > taxBrackets.medicareAdditionalThreshold;
  if (additionalMedicareApplies) {
    ficaMedicare +=
      (annualGross - taxBrackets.medicareAdditionalThreshold) *
      taxBrackets.medicareAdditionalRate;
    if (input.filingStatus === "MFJ") {
      warnings.push(
        `Additional Medicare Tax: your employer withholds the 0.9% surtax on individual wages above ` +
          `$${taxBrackets.medicareAdditionalThreshold.toLocaleString()}, but MFJ filers owe it on combined ` +
          `household income above $250k. If your combined income is below $250k you can claim a credit ` +
          `on Form 8959; if both spouses earn under $200k but combined income exceeds $250k, you may owe ` +
          `additional tax at filing.`,
      );
    }
  }
  ficaMedicare = roundToCents(ficaMedicare);

  // ── Step 5: Totals and rates ──
  const totalTax = federalTax + ficaSS + ficaMedicare;
  // Effective rate = total tax burden as a percentage of gross income
  const effectiveRate = Number(safeDivide(totalTax, annualGross) ?? 0);

  return {
    taxableIncome: roundToCents(taxableIncome),
    federalTax,
    effectiveRate,
    marginalRate,
    ficaSS,
    ficaMedicare,
    totalTax: roundToCents(totalTax),
    w4CheckboxUsed,
    warnings,
  };
}
