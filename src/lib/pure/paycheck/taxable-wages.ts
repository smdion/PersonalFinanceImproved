/** Which payroll money reduces federal taxable wages, and which FICA wages. */
import type { PaycheckInput } from "./paycheck.types";

/** Per-period payroll contribution that isn't FICA wages: the contribution,
 *  up to its yearly FICA-exempt cap spread over the year. 0 when the
 *  account's payroll money is FICA wages (cap null) or not payroll-deducted. */
export function regularFicaExemptPerPeriod(
  ca: PaycheckInput["contributionAccounts"][number],
  periodsPerYear: number,
): number {
  const cap = ca.ficaExemptAnnualCap;
  if (!ca.isPayrollDeducted || cap === null) return 0;
  // Only pre-tax money skips FICA — an after-tax row (bad data, an old
  // backup) is FICA wages, the same read-time rule as deductions.
  if (!isPreTax(ca.taxTreatment)) return 0;
  return Math.min(ca.perPeriodContribution, cap / periodsPerYear);
}

/** Pre-tax treatments: traditional 401k ('pre_tax') and HSA ('hsa') both reduce taxable income. */
export function isPreTax(treatment: string): boolean {
  // lint-violation-ok: "hsa" here is the tax-treatment value (TaxTreatment enum), not an account category
  return treatment === "pre_tax" || treatment === "hsa";
}
