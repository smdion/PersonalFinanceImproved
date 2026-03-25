/**
 * Pure business logic for household-level tax aggregation.
 * Extracted from paycheck router — no DB or I/O dependency.
 */

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
  const combinedGross = people.reduce((s, p) => s + p.salary, 0);
  const perPersonFicaSS = people.reduce((s, p) => s + p.ficaSS, 0);
  const perPersonFicaMed = people.reduce((s, p) => s + p.ficaMedicare, 0);

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
