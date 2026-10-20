/**
 * One person's tax through the household calculator — the shape the IRS
 * golden tests are written in (gross + pre-tax for a household of one).
 */
import { calculateHouseholdTax } from "@/lib/calculators/tax";
import type {
  FilingStatusType,
  TaxBracketInput,
} from "@/lib/calculators/types";

export type OnePersonTaxInput = {
  annualGross: number;
  preTaxDeductionsAnnual: number;
  filingStatus?: FilingStatusType;
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
    people: [
      {
        gross: input.annualGross,
        preTaxFederal: input.preTaxDeductionsAnnual,
        ficaWages: input.ficaWagesAnnual ?? input.annualGross,
      },
    ],
    taxBrackets: input.taxBrackets,
    medicareLiabilityThreshold:
      input.medicareLiabilityThreshold ??
      input.taxBrackets.medicareAdditionalThreshold,
  });
  return { ...r, agi: r.wageAgi };
}
