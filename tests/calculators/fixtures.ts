/**
 * Shared test fixtures — synthetic input data for calculator validation.
 *
 * These values are representative of a dual-income household and are used
 * to validate calculator outputs against Section 10 test cases.
 */
import type {
  TaxBracketInput,
  DeductionLine,
  ContributionAccountInput,
  PaycheckInput,
  TaxInput,
  ContributionInput,
  NetWorthInput,
  SavingsInput,
  MortgageInput,
} from "@/lib/calculators/types";

// ── 2025 MFJ Tax Brackets (W-4 2(c) CHECKED) ──
// These are the halved brackets used for paycheck withholding when both spouses work.
export const MFJ_2C_BRACKETS: TaxBracketInput = {
  filingStatus: "MFJ",
  w4Checkbox: true,
  brackets: [
    { min: 0, max: 16100, rate: 0 },
    { min: 16100, max: 28500, rate: 0.1 },
    { min: 28500, max: 66500, rate: 0.12 },
    { min: 66500, max: 121800, rate: 0.22 },
    { min: 121800, max: 217875, rate: 0.24 },
    { min: 217875, max: 272325, rate: 0.32 },
    { min: 272325, max: 400450, rate: 0.35 },
    { min: 400450, max: null, rate: 0.37 },
  ],
  standardDeduction: 30000,
  socialSecurityWageBase: 176100,
  socialSecurityRate: 0.062,
  medicareRate: 0.0145,
  medicareAdditionalRate: 0.009,
  medicareAdditionalThreshold: 200000,
};

// ── 2025 MFJ Tax Brackets (NO checkbox) ──
// Standard brackets for annual tax estimation.
export const MFJ_NO_CHECKBOX_BRACKETS: TaxBracketInput = {
  filingStatus: "MFJ",
  w4Checkbox: false,
  brackets: [
    { min: 0, max: 19300, rate: 0 },
    { min: 19300, max: 44100, rate: 0.1 },
    { min: 44100, max: 120100, rate: 0.12 },
    { min: 120100, max: 230700, rate: 0.22 },
    { min: 230700, max: 422850, rate: 0.32 },
    { min: 422850, max: 531750, rate: 0.35 },
    { min: 531750, max: 788000, rate: 0.37 },
    { min: 788000, max: null, rate: 0.37 },
  ],
  standardDeduction: 30000,
  socialSecurityWageBase: 176100,
  socialSecurityRate: 0.062,
  medicareRate: 0.0145,
  medicareAdditionalRate: 0.009,
  medicareAdditionalThreshold: 200000,
};

// ── Person A's Paycheck Input ──
// Salary: $120,000, Biweekly, 2(c) checked
// Deductions: STD $30 LTD $22 (both pre-tax + FICA-exempt)
// Contributions: Roth 401k 14% (payroll-deducted), Roth IRA $312.50 (NOT payroll), Brokerage $75 (NOT payroll)
export const PERSON_A_DEDUCTIONS: DeductionLine[] = [
  { name: "STD", amount: 30.0, taxTreatment: "pre_tax", ficaExempt: true },
  { name: "LTD", amount: 22.0, taxTreatment: "pre_tax", ficaExempt: true },
];

export const PERSON_A_CONTRIBUTIONS: ContributionAccountInput[] = [
  {
    name: "Roth 401k",
    annualContribution: 16800.0, // 120000 * 0.14
    perPeriodContribution: 646.15, // 16800 / 26
    taxTreatment: "tax_free",
    isPayrollDeducted: true,
    group: "retirement",
    employerMatch: 4200.0, // 50% match up to 7% = 3.5% of salary
    employerMatchTaxTreatment: "pre_tax",
  },
  {
    name: "Roth IRA",
    annualContribution: 8125.0, // 312.50 * 26
    perPeriodContribution: 312.5,
    taxTreatment: "tax_free",
    isPayrollDeducted: false,
    group: "retirement",
    employerMatch: 0,
    employerMatchTaxTreatment: "pre_tax",
  },
  {
    name: "LT Brokerage",
    annualContribution: 1950.0, // 75 * 26
    perPeriodContribution: 75,
    taxTreatment: "after_tax",
    isPayrollDeducted: false,
    group: "portfolio",
    employerMatch: 0,
    employerMatchTaxTreatment: "pre_tax",
  },
];

export const PERSON_A_PAYCHECK_INPUT: PaycheckInput = {
  annualSalary: 120000,
  payPeriod: "biweekly",
  payWeek: "even",
  anchorPayDate: new Date("2025-01-03"),
  supplementalTaxRate: 0.22,
  contributionAccounts: PERSON_A_CONTRIBUTIONS,
  deductions: PERSON_A_DEDUCTIONS,
  taxBrackets: MFJ_2C_BRACKETS,
  limits: {},
  ytdGrossEarnings: 0,
  bonusPercent: 0.1,
  bonusMultiplier: 1.0,
  bonusOverride: null,
  monthsInBonusYear: 12,
  includeContribInBonus: true,
  bonusMonth: null,
  bonusDayOfMonth: null,
  asOfDate: new Date("2025-03-07"),
};

// ── Person B's Paycheck Input ──
// Salary: $110,000, Biweekly, 2(c) checked
// Deductions: Dental $8, Medical $140, Vision $5 (all pre-tax + FICA-exempt)
// Contributions: Trad 401k 16% (payroll), Roth 401k 5% (payroll), HSA $321 (payroll), ESPP 10% (payroll)
//               Roth IRA $312.50 (NOT payroll)
export const PERSON_B_DEDUCTIONS: DeductionLine[] = [
  { name: "Dental", amount: 8.0, taxTreatment: "pre_tax", ficaExempt: true },
  { name: "Medical", amount: 140.0, taxTreatment: "pre_tax", ficaExempt: true },
  { name: "Vision", amount: 5.0, taxTreatment: "pre_tax", ficaExempt: true },
];

export const PERSON_B_CONTRIBUTIONS: ContributionAccountInput[] = [
  {
    name: "Traditional 401k",
    annualContribution: 17600.0, // 110000 * 0.16
    perPeriodContribution: 676.92, // 17600 / 26
    taxTreatment: "pre_tax",
    isPayrollDeducted: true,
    group: "retirement",
    employerMatch: 5500.0, // 100% match up to 5%
    employerMatchTaxTreatment: "pre_tax",
  },
  {
    name: "Roth 401k",
    annualContribution: 5500.0, // 110000 * 0.05
    perPeriodContribution: 211.54, // 5500 / 26
    taxTreatment: "tax_free",
    isPayrollDeducted: true,
    group: "retirement",
    employerMatch: 0,
    employerMatchTaxTreatment: "pre_tax",
  },
  {
    name: "HSA",
    annualContribution: 8346.0, // 321 * 26
    perPeriodContribution: 321.0,
    taxTreatment: "hsa",
    isPayrollDeducted: true,
    group: "portfolio",
    employerMatch: 400,
    employerMatchTaxTreatment: "pre_tax",
  },
  {
    name: "ESPP",
    annualContribution: 11000.0, // 110000 * 0.10
    perPeriodContribution: 423.08, // 11000 / 26
    taxTreatment: "after_tax",
    isPayrollDeducted: true,
    group: "portfolio",
    employerMatch: 0,
    employerMatchTaxTreatment: "pre_tax",
  },
  {
    name: "Roth IRA",
    annualContribution: 8125.0,
    perPeriodContribution: 312.5,
    taxTreatment: "tax_free",
    isPayrollDeducted: false,
    group: "retirement",
    employerMatch: 0,
    employerMatchTaxTreatment: "pre_tax",
  },
];

export const PERSON_B_PAYCHECK_INPUT: PaycheckInput = {
  annualSalary: 110000,
  payPeriod: "biweekly",
  payWeek: "odd",
  anchorPayDate: new Date("2025-01-10"),
  supplementalTaxRate: 0.22,
  contributionAccounts: PERSON_B_CONTRIBUTIONS,
  deductions: PERSON_B_DEDUCTIONS,
  taxBrackets: MFJ_2C_BRACKETS,
  limits: {},
  ytdGrossEarnings: 0,
  bonusPercent: 0.15,
  bonusMultiplier: 1.0,
  bonusOverride: null,
  monthsInBonusYear: 12,
  includeContribInBonus: false,
  bonusMonth: null,
  bonusDayOfMonth: null,
  asOfDate: new Date("2025-03-07"),
};

export const AS_OF_DATE = new Date("2025-03-07");
