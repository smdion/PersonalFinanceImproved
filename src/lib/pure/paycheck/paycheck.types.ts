/** The paycheck calculator's input lines: pay periods, deductions,
 *  earnings, the withholding tables and the contribution accounts a check
 *  pays into. */

import type { TaxTreatment } from "@/lib/config/enum-values";
import type { FilingStatusKey } from "@/lib/config/filing-status";

export type PayPeriodType = "weekly" | "biweekly" | "semimonthly" | "monthly";

export type DeductionLine = {
  name: string;
  amount: number;
  taxTreatment: TaxTreatment;
  ficaExempt: boolean;
};

/** Pay on a check besides salary (paycheck_earnings + the Salary Profile's
 *  amount). `isCash` false = a taxable benefit that's never paid (imputed
 *  income): taxed, not take-home. */
export type EarningLine = {
  name: string;
  /** Per check. */
  amount: number;
  isCash: boolean;
  federalTaxable: boolean;
  ficaTaxable: boolean;
};

export type TaxBracketInput = {
  /** The table's status: the W-4 box for withholding, the return's for
   *  the year's liability. */
  filingStatus: FilingStatusKey;
  w4Checkbox: boolean; // whether this bracket set is the 2(c) checked version
  brackets: { min: number; max: number | null; rate: number }[];
  standardDeduction: number;
  /** Pub 15-T Worksheet 1A line 1g: subtracted from annualized wages before
   *  the bracket lookup when the W-4 2(c) box is unchecked; 0 when checked.
   *  Withholding only: calculateHouseholdTax doesn't use it. */
  w4Adjustment: number;
  socialSecurityWageBase: number;
  socialSecurityRate: number;
  medicareRate: number;
  medicareAdditionalRate: number;
  medicareAdditionalThreshold: number;
};

export type ContributionAccountInput = {
  /** The contribution_accounts row it came from, when there is one. */
  id?: number;
  name: string;
  annualContribution: number;
  perPeriodContribution: number;
  /** Fractional rate of gross pay (e.g. 0.14 for 14%). Non-null only for
   *  percent_of_salary accounts — scales contributions against bonus gross
   *  rather than reusing the regular per-period dollar amount. */
  rateOfGross: number | null;
  taxTreatment: TaxTreatment;
  isPayrollDeducted: boolean;
  /** Also taken from bonus checks (bonusCheckContribution). */
  fromBonus: boolean;
  group: string; // e.g. 'retirement', 'portfolio' — driven by account data, not hardcoded
  employerMatch: number;
  /** Of employerMatch, the part that matches what the bonus check takes. */
  employerMatchOnBonus?: number;
  /** The match this account would get at the plan's cap — the full match.
   *  Equals employerMatch when uncapped or a flat amount. */
  employerMatchAvailable?: number;
  /** The share of pay that gets the full employer match (the match cap);
   *  null/absent when the match doesn't depend on the rate. */
  fullMatchShareOfPay?: number | null;
  employerMatchTaxTreatment: TaxTreatment;
  /** Yearly cap on this account's payroll contributions that aren't FICA
   *  wages (payrollFicaExemptCap); null = they are FICA wages; Infinity =
   *  exempt in full (cap can't be sized). */
  ficaExemptAnnualCap: number | null;
};
