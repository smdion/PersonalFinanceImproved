/** Which payroll money reduces federal taxable wages, and which FICA wages. */
import type { PaycheckInput } from "./paycheck.types";

/** A check's payroll money that isn't FICA wages: up to the FICA-exempt cap over its covered checks
 *  (else the year's paydays); 0 when it is FICA wages (cap null) or not payroll-deducted. */
export function regularFicaExemptPerPeriod(
  ca: PaycheckInput["contributionAccounts"][number],
  paydays: number,
): number {
  const cap = ca.ficaExemptAnnualCap;
  if (!ca.isPayrollDeducted || cap === null) return 0;
  // Only pre-tax money skips FICA — an after-tax row (bad data, an old
  // backup) is FICA wages, the same read-time rule as deductions.
  if (!isPreTax(ca.taxTreatment)) return 0;
  const covered = ca.coveredChecks ?? paydays;
  return Math.min(ca.perPeriodContribution, cap / covered);
}

/** Pre-tax treatments: traditional 401k ('pre_tax') and HSA ('hsa') both reduce taxable income. */
export function isPreTax(treatment: string): boolean {
  // lint-violation-ok: "hsa" here is the tax-treatment value (TaxTreatment enum), not an account category
  return treatment === "pre_tax" || treatment === "hsa";
}
