/**
 * Pure business logic for household-level tax aggregation.
 * Extracted from paycheck router — no DB or I/O dependency.
 */
import { sumBy } from "@/lib/utils/math";

/** Per-person tax data needed for household aggregation. */
export type PersonTaxData = {
  salary: number;
  preTaxDeductionsAnnual: number;
  ficaSS: number;
  ficaMedicare: number;
};

/** Result of household tax computation. */
export type HouseholdTaxResult = {
  federalTax: number;
  ficaSS: number;
  ficaMedicare: number;
  totalTax: number;
  effectiveRate: number;
  marginalRate: number;
};

/**
 * Compute household-level tax by combining incomes and applying ONE standard deduction,
 * while keeping FICA per-person (each has own SS wage base cap).
 *
 * @param people - Per-person salary and deduction data
 * @param combinedTaxResult - Result of running calculateTax on the combined income
 */
export function computeHouseholdTax(
  people: PersonTaxData[],
  combinedTaxResult: { federalTax: number; marginalRate: number },
): HouseholdTaxResult {
  const combinedGross = sumBy(people, (p) => p.salary);
  const perPersonFicaSS = sumBy(people, (p) => p.ficaSS);
  const perPersonFicaMed = sumBy(people, (p) => p.ficaMedicare);

  const totalTax =
    combinedTaxResult.federalTax + perPersonFicaSS + perPersonFicaMed;

  return {
    federalTax: combinedTaxResult.federalTax,
    ficaSS: perPersonFicaSS,
    ficaMedicare: perPersonFicaMed,
    totalTax,
    effectiveRate: combinedGross > 0 ? totalTax / combinedGross : 0,
    marginalRate: combinedTaxResult.marginalRate,
  };
}

/**
 * Compute combined pre-tax deductions across multiple people.
 * Each person's per-period deductions are scaled by their periods per year.
 */
export function combinedPreTaxDeductions(
  people: { preTaxPerPeriod: number; periodsPerYear: number }[],
): number {
  return people.reduce(
    (sum, p) => sum + p.preTaxPerPeriod * p.periodsPerYear,
    0,
  );
}
