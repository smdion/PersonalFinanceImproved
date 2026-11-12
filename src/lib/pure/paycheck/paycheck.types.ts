/** The paycheck calculator's input and result: pay periods, deductions,
 *  earnings, the withholding tables, the contribution accounts a check
 *  pays into, and the per-check, bonus and blended-year results. */

import type { SalaryDivisor, TaxTreatment } from "@/lib/config/enum-values";
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
  employerMatchOnBonus: number;
  /** The match this account would get at the plan's cap — the full match.
   *  Equals employerMatch when uncapped or a flat amount. */
  employerMatchAvailable?: number;
  /** The share of pay that gets the full employer match (the match cap);
   *  null/absent when the match doesn't depend on the rate. */
  fullMatchShareOfPay?: number | null;
  employerMatchTaxTreatment: TaxTreatment;
  /** Yearly cap on this account's payroll contributions that aren't FICA
   *  wages (payrollFicaExemptCap); null = they are FICA wages; Infinity =
   *  exempt in full (a capped row, or a cap that can't be sized). */
  ficaExemptAnnualCap: number | null;
};

export type PeriodBreakdown = {
  periodNumber: number;
  gross: number;
  federalWithholding: number;
  ficaSS: number;
  ficaMedicare: number;
  preTaxDeductions: number;
  postTaxDeductions: number;
  netPay: number;
  bonusGross: number; // bonus amount included in this period (0 for non-bonus periods)
  bonusWithholding: number; // federal withholding on bonus portion
  bonusFica: number; // FICA on bonus portion
  /** A payday this year before the job started — not this job's check
   *  (every amount 0). Periods keep their calendar number. */
  beforeStart?: true;
  /** A payday this year after the job's last day — not this job's check
   *  (every amount 0). */
  afterEnd?: true;
};

export type BonusEstimate = {
  bonusGross: number;
  bonusNet: number;
  bonusFederalWithholding: number;
  /** Social Security and Medicare, Additional Medicare included, as if paid after the regular checks. */
  bonusFica: number;
  bonusContributions: number;
  /** The bonus's FICA wages: bonusGross less FICA-exempt payroll contributions the bonus check takes. */
  bonusFicaWages: number;
  /** The bonus's federal taxable wages: bonusGross less the pre-tax
   *  contributions the bonus check takes — what the supplemental rate
   *  applies to. */
  bonusFederalTaxable: number;
  /** The contributions the bonus check takes, as its deduction lines. */
  bonusLines: DeductionLine[];
};

export type PaycheckInput = {
  annualSalary: number;
  payPeriod: PayPeriodType;
  /** What the salary is divided by for each check (the Salary Profile entry's). Absent: the
   *  pay schedule's usual periods (DEFAULT_SALARY_DIVISOR). */
  salaryDivisor?: SalaryDivisor;
  payWeek: "even" | "odd" | "na";
  anchorPayDate: Date; // a known payday for this job, used to derive extra paycheck months
  supplementalTaxRate: number; // IRS supplemental withholding rate (e.g. 0.22)
  additionalFedWithholding: number; // W-4 Line 4c — flat extra $ added to PER-CHECK federal withholding after bracket withholding, never annualized and never applied to the supplemental bonus rate
  contributionAccounts: ContributionAccountInput[];
  deductions: DeductionLine[];
  /** Other pay and taxable benefits on each check (beyond salary). */
  earnings: EarningLine[];
  taxBrackets: TaxBracketInput;
  limits: Record<string, number>;
  bonusPercent: number;
  bonusMultiplier: number;
  bonusOverride: number | null; // if set, use this value as gross bonus instead of calculating
  monthsInBonusYear: number;
  bonusMonth: number | null; // 1-12, month when bonus is paid (null = unknown/not modeled)
  bonusDayOfMonth: number | null; // 1-31, day of month when bonus is paid (null = first period of month)
  asOfDate: Date;
  /** The job's start date — a job started this year has no checks before
   *  it. Absent: paid all year. */
  startDate?: Date | null;
  /** The job's last day — a job ending this year has no checks after it.
   *  Absent: paid to the year's end. */
  endDate?: Date | null;
};

export type PaycheckResult = {
  /** Cash pay per check: salary ÷ periods + cash earnings. */
  gross: number;
  /** The other pay / taxable-benefit lines on each check. */
  earnings: EarningLine[];
  preTaxDeductions: DeductionLine[];
  federalTaxableGross: number;
  federalWithholding: number;
  /** Per-period FICA wages: gross less Section 125 deductions and FICA-exempt payroll contributions. */
  ficaWages: number;
  ficaSS: number;
  ficaMedicare: number;
  postTaxDeductions: DeductionLine[];
  netPay: number;
  bonusEstimate: BonusEstimate;
  bonusPeriod: number | null; // which period number the bonus lands in (null if no bonusMonth)
  extraPaycheckMonths: string[];
  yearSchedule: PeriodBreakdown[];
  periodsPerYear: number;
  /** Paydays so far this year, by the calendar (the year schedule's index). */
  periodsElapsedYtd: number;
  /** This year's paydays before the job started (0 for a job held all
   *  year). Checks this job has paid so far = periodsElapsedYtd − this. */
  periodsBeforeStart: number;
  /** The bonus is dated before the job started — not this job's, so not
   *  in this year's pay (bonusPeriod is null then too). */
  bonusBeforeStart: boolean;
  /** The bonus's check is after the job's last check this year (dated
   *  after its last day, or undated for a job ending this year) — not in
   *  this year's pay (bonusPeriod is null then too). */
  bonusAfterEnd: boolean;
  /** A bonus amount with no month set (bonusPeriod is null then too). */
  bonusUndated: boolean;
  nextPayDate: string; // ISO date string of next upcoming payday
  payFrequencyLabel: string; // human-readable label like "Biweekly (Even Weeks)"
  warnings: string[];
};

/** The Year-end estimate: the job's checks this year, summed from the year schedule. */
export type BlendedAnnualTotals = {
  gross: number;
  federalWithholding: number;
  ficaSS: number;
  ficaMedicare: number;
  preTaxDeductions: number;
  postTaxDeductions: number;
  netPay: number;
  /** The job's salary (one salary a year). */
  blendedSalary: number;
  /** The checks at that salary, for the panel's footnote. */
  segments: {
    salary: number;
    periods: number;
    effectiveDate: string | null;
  }[];
};

/** The bonus terms computeBonusGross takes, in its own argument types. */
export type BonusTerms = {
  bonusPercent: string | null;
  bonusMultiplier: string | null;
  monthsInBonusYear: number | null;
};
