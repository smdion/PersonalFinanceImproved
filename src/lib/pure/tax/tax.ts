/**
 * Annual federal tax liability: one standard deduction and brackets on combined income, SS and
 * Medicare per person, and 0.9% Additional Medicare above the LIABILITY threshold. Tax-exempt
 * interest isn't in provisional income for SS taxation (no muni data model).
 */
import type { TaxBracketInput } from "../paycheck/paycheck.types";
import { additionalMedicareWithheld } from "../paycheck/additional-medicare";
import { roundToCents, safeDivide, sumBy } from "../../utils/math";
import { formatCurrency } from "../../utils/format";
import { sumBracketTax } from "./tax-brackets";
import {
  returnDeductions,
  type ReturnDeductionTerms,
} from "./return-deductions";

/** One person's earnings for the year, as the tax sees them (see computeAnnualEarnings). */
type TaxEarnings = {
  /** Federal income-tax wages: taxable pay (incl. imputed income) less pre-tax money. */
  federalWages: number;
  /** Social Security / Medicare wages: gross less Section 125 deductions and FICA-exempt payroll contributions, plus FICA-taxable benefits. */
  ficaWages: number;
  /** HSA money paid in outside payroll: an above-the-line deduction (Form
   *  8889; Schedule 1 line 13), off AGI but not off FICA wages. */
  hsaOutsidePayroll: number;
};

type HouseholdTaxInput = {
  people: TaxEarnings[];
  /** Liability brackets (non-2(c)) with the filing status's standard deduction. */
  taxBrackets: TaxBracketInput;
  /** The filing status's Additional Medicare LIABILITY threshold
   *  (`fica_medicare_surtax_liability_<status>`). null when the tax data
   *  lacks the row — the withholding threshold is used, with a warning. */
  medicareLiabilityThreshold: number | null;
  /** The year's §63(f) add-on and senior deduction terms, how many on the
   *  return are 65+, and the tax year. */
  ageDeductions: {
    terms: Omit<ReturnDeductionTerms, "basic">;
    over65: number;
    year: number;
  };
};

type HouseholdTaxResult = {
  /** Line 11 for wage income: Σ federal wages less the above-the-line
   *  adjustments (no investment income). */
  wageAgi: number;
  /** The above-the-line adjustments taken off wages: HSA money paid in
   *  outside payroll (Schedule 1 line 13). */
  aboveTheLineAdjustments: number;
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

  // ── Federal: combined income, one return's deductions ──
  // Itemized deductions are not modelled.
  const aboveTheLineAdjustments = sumBy(people, (p) => p.hsaOutsidePayroll);
  const wageAgi =
    sumBy(people, (p) => p.federalWages) - aboveTheLineAdjustments;
  const { ageDeductions } = input;
  const { standardDeduction, seniorDeduction } = returnDeductions({
    terms: { ...ageDeductions.terms, basic: taxBrackets.standardDeduction },
    over65: ageDeductions.over65,
    magi: { kind: "known", value: wageAgi },
    year: ageDeductions.year,
  });
  const taxableIncome = Math.max(
    0,
    wageAgi - standardDeduction - seniorDeduction,
  );
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
    sumBy(people, (p) =>
      additionalMedicareWithheld(taxBrackets, p.ficaWages, p.ficaWages),
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
    aboveTheLineAdjustments: roundToCents(aboveTheLineAdjustments),
    taxableIncome: roundToCents(taxableIncome),
    federalTax,
    marginalRate: bracketResult.marginalRate,
    ficaSS,
    ficaMedicare,
    additionalMedicare,
    totalTax,
    effectiveRate: Number(safeDivide(federalTax, wageAgi)),
    warnings,
  };
}
