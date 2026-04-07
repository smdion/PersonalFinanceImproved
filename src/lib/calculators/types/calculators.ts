// Calculator-specific input/output types.
// Decoupled from Drizzle schema types — all numeric fields are `number`, not string.
// Every result type includes `warnings: string[]` and every input includes `asOfDate: Date`.

import type {
  PayPeriodType,
  FilingStatusType,
  DeductionLine,
  TaxBracketInput,
  ContributionAccountInput,
} from "./shared";

// --- Paycheck ---

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
};

export type BonusEstimate = {
  bonusGross: number;
  bonusNet: number;
  bonusFederalWithholding: number;
  bonusFica: number;
};

export type PaycheckInput = {
  annualSalary: number;
  payPeriod: PayPeriodType;
  payWeek: "even" | "odd" | "na";
  anchorPayDate: Date; // a known payday for this job, used to derive extra paycheck months
  supplementalTaxRate: number; // IRS supplemental withholding rate (e.g. 0.22)
  contributionAccounts: ContributionAccountInput[];
  deductions: DeductionLine[];
  taxBrackets: TaxBracketInput;
  limits: Record<string, number>;
  ytdGrossEarnings: number;
  bonusPercent: number;
  bonusMultiplier: number;
  bonusOverride: number | null; // if set, use this value as gross bonus instead of calculating
  monthsInBonusYear: number;
  includeContribInBonus: boolean; // whether 401k is deducted from bonus paycheck
  bonusMonth: number | null; // 1-12, month when bonus is paid (null = unknown/not modeled)
  bonusDayOfMonth: number | null; // 1-31, day of month when bonus is paid (null = first period of month)
  asOfDate: Date;
};

export type PaycheckResult = {
  gross: number;
  preTaxDeductions: DeductionLine[];
  federalTaxableGross: number;
  federalWithholding: number;
  ficaSS: number;
  ficaMedicare: number;
  postTaxDeductions: DeductionLine[];
  netPay: number;
  bonusEstimate: BonusEstimate;
  bonusPeriod: number | null; // which period number the bonus lands in (null if no bonusMonth)
  extraPaycheckMonths: string[];
  yearSchedule: PeriodBreakdown[];
  periodsPerYear: number;
  periodsElapsedYtd: number;
  nextPayDate: string; // ISO date string of next upcoming payday
  payFrequencyLabel: string; // human-readable label like "Biweekly (Even Weeks)"
  warnings: string[];
};

/** Blended annual totals computed from a salary timeline with mid-year changes. */
export type BlendedAnnualTotals = {
  gross: number;
  federalWithholding: number;
  ficaSS: number;
  ficaMedicare: number;
  preTaxDeductions: number;
  postTaxDeductions: number;
  netPay: number;
  /** Weighted average salary across all segments. */
  blendedSalary: number;
  /** Per-segment breakdown for UI transparency. */
  segments: {
    salary: number;
    periods: number;
    effectiveDate: string | null;
  }[];
};

// --- Tax ---

export type TaxInput = {
  annualGross: number;
  preTaxDeductionsAnnual: number;
  filingStatus: FilingStatusType;
  taxBrackets: TaxBracketInput;
  w4CheckboxOverride: boolean | null; // null = auto-detect, true/false = user override
  asOfDate: Date;
};

export type TaxResult = {
  taxableIncome: number;
  federalTax: number;
  effectiveRate: number;
  marginalRate: number;
  ficaSS: number;
  ficaMedicare: number;
  totalTax: number;
  w4CheckboxUsed: boolean;
  warnings: string[];
};

// --- Budget ---

export type BudgetItemInput = {
  category: string;
  label: string;
  amounts: number[];
  isEssential: boolean;
};

export type BudgetInput = {
  items: BudgetItemInput[];
  columnLabels: string[];
  selectedColumn: number; // index into columnLabels/amounts (0=Standard, 1=Tight, 2=Emergency)
  asOfDate: Date;
};

export type BudgetResult = {
  totalMonthly: number;
  essentialTotal: number;
  discretionaryTotal: number;
  categories: {
    name: string;
    total: number;
    items: { label: string; amount: number; isEssential: boolean }[];
  }[];
  warnings: string[];
};

// --- Contribution ---

export type ContributionInput = {
  annualSalary: number;
  /** Total compensation (always includes bonus) — used as denominator for savings rates.
   *  Falls back to annualSalary if not provided. */
  totalCompensation?: number;
  contributionAccounts: ContributionAccountInput[];
  limits: Record<string, number>;
  asOfDate: Date;
};

export type ContributionResult = {
  groupRates: Record<string, number>; // includes employer match
  groupRatesExMatch: Record<string, number>; // employee contributions only (no match)
  totalAnnualContributions: number; // employee + employer
  totalEmployeeOnly: number; // employee contributions only
  accounts: {
    name: string;
    group: string;
    annualContribution: number;
    employerMatch: number;
    percentOfSalary: number;
  }[];
  warnings: string[];
};

// --- Mortgage ---

export type MortgageLoanInput = {
  id: number;
  name: string;
  originalBalance: number;
  interestRate: number;
  termMonths: number;
  startDate: Date;
  monthlyPI: number;
  refinancedFromId?: number;
  isActive: boolean;
  paidOffDate?: Date;
  apiBalance?: number;
  apiBalanceDate?: Date;
};

export type MortgageExtraPayment = {
  loanId: number;
  date: Date;
  amount: number;
};

export type MortgageWhatIf = {
  id?: number;
  label: string;
  extraMonthlyPrincipal: number;
  extraOneTimePayment?: number;
  refinanceRate?: number;
  refinanceTerm?: number;
  loanId?: number;
};

export type MortgageInput = {
  loans: MortgageLoanInput[];
  extraPayments: MortgageExtraPayment[];
  whatIfScenarios: MortgageWhatIf[];
  asOfDate: Date;
};

export type AmortizationEntry = {
  month: number;
  date: Date;
  payment: number;
  principal: number;
  interest: number;
  extraPayment: number;
  balance: number;
};

export type MortgageLoanResult = {
  loanId: number;
  name: string;
  currentBalance: number;
  payoffPercent: number;
  totalInterestPaid: number;
  totalInterestLife: number;
  totalInterestSaved: number;
  remainingMonths: number;
  monthsAheadOfSchedule: number;
  payoffDate: Date;
  amortizationSchedule: AmortizationEntry[];
  /** For historical (refinanced) loans: what the full-term standard interest would have been
   *  if the loan ran to completion with no extras. Used by the Refinance Impact comparison.
   *  Undefined for active loans. */
  fullTermStandardInterest?: number;
  /** Date the loan was paid off or refinanced. Only set for historical loans. */
  paidOffDate?: Date;
  /** Balance at the time the loan was paid off / refinanced. */
  endedBalance?: number;
  /** Whether this loan was refinanced into another loan. */
  wasRefinanced?: boolean;
  /** API-synced balance (e.g. from YNAB). When present, overrides the calculated balance. */
  apiBalance?: number;
  /** Date the API balance was last synced. */
  apiBalanceDate?: Date;
  /** Amortization-calculated balance before API override (only set when apiBalance differs). */
  calculatedBalance?: number;
};

export type MortgageWhatIfResult = {
  scenarioId?: number;
  label: string;
  payoffDate: Date;
  totalInterest: number;
  interestSaved: number;
  monthsSaved: number;
};

export type LoanHistoryEntry = {
  loanId: number;
  name: string;
  isActive: boolean;
  refinancedInto?: string;
  paidOffDate?: Date;
  endedBalance?: number;
};

export type MortgageResult = {
  loans: MortgageLoanResult[];
  historicalLoans: MortgageLoanResult[];
  loanHistory: LoanHistoryEntry[];
  whatIfResults: MortgageWhatIfResult[];
  warnings: string[];
};

// --- Net Worth ---

export type NetWorthInput = {
  portfolioTotal: number;
  cash: number;
  homeValueEstimated: number; // current market estimate (for NW+)
  homeValueConservative: number; // purchase price + improvements (for NW-)
  otherAssets: number;
  mortgageBalance: number; // current amortized balance
  otherLiabilities: number;
  averageAge: number; // average of all people's ages (was: primary person only)
  effectiveIncome: number; // combinedAgi, optionally 3yr averaged (was: annualSalary)
  lifetimeEarnings: number; // cumulative AGI through this year
  annualExpenses: number;
  withdrawalRate: number; // e.g. 0.04 for the 4% rule — from retirement settings
  asOfDate: Date;
};

export type NetWorthResult = {
  netWorthMarket: number; // uses current market value for home
  netWorthCostBasis: number; // uses purchase price + improvements for home
  netWorth: number; // alias for netWorthMarket (primary display)
  totalAssets: number;
  totalLiabilities: number;
  wealthScoreMarket: number; // netWorthMarket / lifetimeEarnings
  wealthScoreCostBasis: number; // netWorthCostBasis / lifetimeEarnings
  aawScoreMarket: number; // Money Guy formula using market NW
  aawScoreCostBasis: number; // Money Guy formula using cost basis NW
  fiProgress: number;
  fiTarget: number;
  warnings: string[];
};

// --- Savings ---

export type SavingsGoalInput = {
  id: number;
  name: string;
  currentBalance: number;
  targetBalance: number;
  allocationPercent: number; // share of the monthly savings pool
  isEmergencyFund: boolean;
  isActive: boolean;
};

export type SavingsInput = {
  goals: SavingsGoalInput[];
  monthlySavingsPool: number; // from budget — total available for savings
  essentialMonthlyExpenses: number;
  asOfDate: Date;
};

export type SavingsResult = {
  efundMonthsCovered: number | null;
  totalSaved: number;
  goals: {
    goalId: number;
    name: string;
    current: number;
    target: number;
    monthlyAllocation: number;
    progress: number;
    monthsToTarget: number | null;
  }[];
  warnings: string[];
};

// --- E-Fund ---

export type EFundInput = {
  emergencyFundBalance: number;
  outstandingSelfLoans: number; // money owed back to the e-fund (subtracted from true balance, added in "with repay")
  essentialMonthlyExpenses: number;
  targetMonths: number; // user-configurable target (e.g. 4 months)
  asOfDate: Date;
};

export type EFundResult = {
  rawBalance: number; // current balance (before subtracting loans)
  trueBalance: number; // balance minus outstanding self-loans
  outstandingSelfLoans: number;
  balanceWithRepay: number; // rawBalance + selfLoans (what you'd have once loans are repaid)
  monthsCovered: number | null; // rawBalance / essentialExpenses ("Current Months")
  monthsCoveredWithRepay: number | null; // balanceWithRepay / essentialExpenses ("Repaid Months")
  targetMonths: number;
  targetAmount: number; // targetMonths × essentialMonthlyExpenses
  neededAfterRepay: number; // targetAmount - balanceWithRepay (negative = ahead of target)
  progress: number; // monthsCoveredWithRepay / targetMonths
  warnings: string[];
};

// --- Expense YoY ---

export type ExpenseYoYInput = {
  currentPeriod: { category: string; subcategory: string; amount: number }[];
  priorPeriod: { category: string; subcategory: string; amount: number }[];
  asOfDate: Date;
};

export type ExpenseYoYResult = {
  categories: {
    category: string;
    currentTotal: number;
    priorTotal: number;
    dollarChange: number;
    percentChange: number | null; // null if prior was zero
    subcategories: {
      subcategory: string;
      current: number;
      prior: number;
      dollarChange: number;
      percentChange: number | null;
    }[];
  }[];
  grandCurrentTotal: number;
  grandPriorTotal: number;
  grandDollarChange: number;
  grandPercentChange: number | null;
  warnings: string[];
};
