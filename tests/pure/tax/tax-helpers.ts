/**
 * One person's tax through the household calculator — the shape the IRS
 * golden tests are written in (gross + pre-tax for a household of one).
 */
import { calculateHouseholdTax } from "@/lib/pure/tax/tax";
import type { TaxBracketInput } from "@/lib/pure/paycheck/paycheck.types";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

export type OnePersonTaxInput = {
  annualGross: number;
  preTaxDeductionsAnnual: number;
  filingStatus?: ReturnFilingStatus;
  taxBrackets: TaxBracketInput;
  /** Defaults to annualGross. */
  ficaWagesAnnual?: number;
  /** Defaults to the per-employee withholding threshold (equal for Single/HoH). */
  medicareLiabilityThreshold?: number | null;
  w4CheckboxOverride?: boolean | null;
  asOfDate?: Date;
};

export function taxForOnePerson(input: OnePersonTaxInput) {
  const r = calculateHouseholdTax({
    ageDeductions: NO_ONE_65,
    people: [
      {
        federalWages: input.annualGross - input.preTaxDeductionsAnnual,
        ficaWages: input.ficaWagesAnnual ?? input.annualGross,
        hsaOutsidePayroll: 0,
      },
    ],
    taxBrackets: input.taxBrackets,
    medicareLiabilityThreshold:
      input.medicareLiabilityThreshold ??
      input.taxBrackets.medicareAdditionalThreshold,
  });
  return { ...r, agi: r.wageAgi };
}

/** calculateHouseholdTax's age deductions for a return with no one 65+. */
export const NO_ONE_65 = {
  terms: {
    addOnPerCondition: undefined,
    senior: {
      perPerson: undefined,
      phaseoutStart: undefined,
      phaseoutRate: undefined,
      sunsetYear: undefined,
    },
  },
  over65: 0,
  year: 2026,
};
