// Calculator-specific input/output types.
// Decoupled from Drizzle schema types — all numeric fields are `number`, not string.
// Every result type includes `warnings: string[]` and every input includes `asOfDate: Date`.

import type {
  AccountCategory,
  AccountBalance,
} from "@/lib/config/account-types";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";

/**
 * A one-time dollar-amount injection or withdrawal in a specific year.
 * NOT sticky-forward — only applied in the exact override year.
 * Bypasses IRS contribution limits (models rollovers, inheritances, etc.).
 */
export type LumpSum = {
  amount: number;
  targetAccount: AccountCategory;
  taxType?: "traditional" | "roth";
  label?: string;
};

// --- Shared types ---

export type PayPeriodType = "weekly" | "biweekly" | "semimonthly" | "monthly";
export type TaxTreatmentType = "pre_tax" | "tax_free" | "after_tax" | "hsa";
export type FilingStatusType = "MFJ" | "Single" | "HOH";

export type DeductionLine = {
  name: string;
  amount: number;
  taxTreatment: TaxTreatmentType;
  ficaExempt: boolean;
};

export type TaxBracketInput = {
  filingStatus: FilingStatusType;
  w4Checkbox: boolean; // whether this bracket set is the 2(c) checked version
  brackets: { min: number; max: number | null; rate: number }[];
  standardDeduction: number;
  socialSecurityWageBase: number;
  socialSecurityRate: number;
  medicareRate: number;
  medicareAdditionalRate: number;
  medicareAdditionalThreshold: number;
};

export type ContributionAccountInput = {
  name: string;
  annualContribution: number;
  perPeriodContribution: number;
  taxTreatment: TaxTreatmentType;
  isPayrollDeducted: boolean;
  group: string; // e.g. 'retirement', 'portfolio' — driven by account data, not hardcoded
  employerMatch: number;
  employerMatchTaxTreatment: TaxTreatmentType;
};

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
  annualSalary: number;
  annualExpenses: number;
  withdrawalRate: number; // e.g. 0.04 for the 4% rule — from retirement settings
  age: number;
  yearsWorking: number;
  asOfDate: Date;
};

export type NetWorthResult = {
  netWorthMarket: number; // uses current market value for home
  netWorthCostBasis: number; // uses purchase price + improvements for home
  netWorth: number; // alias for netWorthMarket (primary display)
  totalAssets: number;
  totalLiabilities: number;
  wealthScore: number;
  wealthTarget: number;
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

// --- Retirement ---

/** Per-tax-bucket breakdown used throughout retirement projection */
export type TaxBuckets = {
  preTax: number;
  taxFree: number;
  hsa: number;
  afterTax: number;
  /** Cost basis of after-tax (brokerage) holdings. Only gains (afterTax - afterTaxBasis) are taxable on withdrawal. */
  afterTaxBasis: number;
};

/**
 * Per-account balance breakdown by waterfall category and tax treatment.
 * More granular than TaxBuckets — tracks 401k vs IRA separately so
 * decumulation routing uses real balances instead of heuristic splits.
 *
 * Each entry is a discriminated union (AccountBalance) whose shape is
 * determined by the account type's `balanceStructure` config property.
 */
export type AccountBalances = Record<AccountCategory, AccountBalance>;

/** Individual account input for per-account engine tracking. */
export type IndividualAccountInput = {
  /** Display name (e.g. "Alice HSA", "Bob Roth IRA"). */
  name: string;
  /** Waterfall category this account belongs to. */
  category: AccountCategory;
  /** Tax type: 'taxFree' for Roth, 'preTax'/'hsa'/'afterTax' for others. */
  taxType: string;
  /** Raw account type from DB (e.g. "401k", "IRA Traditional", "ESPP"). */
  accountType?: string;
  /** Starting balance from portfolio snapshot. */
  startingBalance: number;
  /** Owner person name (from DB lookup). */
  ownerName?: string;
  /** Owner person ID (from DB). Used for ID-based matching to contribution specs. */
  ownerPersonId?: number;
  /** Parent category from contribution account config (e.g. "Retirement", "Portfolio"). */
  parentCategory?: string;
};

/** Per-account balance tracked through the engine projection. */
export type IndividualAccountYearBalance = {
  name: string;
  category: AccountCategory;
  taxType: string;
  ownerName?: string;
  /** Owner person ID (from DB). Used for ID-based person filtering. */
  ownerPersonId?: number;
  /** Parent category from contribution account config (e.g. "Retirement", "Portfolio"). */
  parentCategory?: string;
  balance: number;
  contribution: number;
  employerMatch: number;
  growth: number;
  /** Per-account withdrawal amount (decumulation only). */
  withdrawal?: number;
  /** Breakdown of contribution sources (brokerage accounts only). */
  intentionalContribution?: number;
  overflowContribution?: number;
  rampContribution?: number;
};

/** Override salary or budget at a specific calendar year in the projection. */
export type RetirementYearOverride = {
  year: number;
  value: number;
  notes?: string;
};

/** Account category — auto-derived from ACCOUNT_TYPE_CONFIG keys. Re-exported for convenience. */
export type {
  AccountCategory,
  AccountBalance,
} from "@/lib/config/account-types";

// ============================================================================
// CONTRIBUTION / DISTRIBUTION ENGINE
// ============================================================================
//
// The engine manages how money flows into accounts (accumulation) and out of
// accounts (decumulation) across the full projection timeline.
//
// CORE CONCEPTS:
//
// 1. ACCOUNT CATEGORIES — The 4 account types money can flow into/out of:
//    • 401k  — employer-sponsored retirement (IRS limit applies)
//    • HSA   — health savings account (IRS limit applies, always pre-tax)
//    • IRA   — individual retirement account (IRS limit applies)
//    • Brokerage — taxable investment account (no IRS limit, catch-all)
//
// 2. TAX TREATMENT — How contributions are taxed:
//    • Traditional — pre-tax now, taxed on withdrawal
//    • Roth        — after-tax now, tax-free withdrawal
//    • HSA is always pre-tax; Brokerage is always after-tax.
//    • 401k and IRA can be split between Traditional and Roth.
//
// 3. ROUTING MODES — Two ways to distribute contributions across accounts:
//    • Waterfall  — fill accounts in priority order up to their limits
//    • Percentage — split contributions by percentage across accounts
//
// 4. STICKY-FORWARD OVERRIDES — Any setting can be changed at any year.
//    The change persists until the next override for that same field.
//    Example: Set contribution rate to 30% in 2028. It stays 30% for 2029,
//    2030, etc. until you set a different rate in another year.
//    Set `reset: true` to revert ALL fields to page-level defaults.
//
// 5. CAPS — Two layers of caps limit contributions:
//    • IRS limits    — hard legal limits per account type (grow ~2%/year)
//    • Artificial caps — user-defined limits below IRS limits
//      - Per-account: "cap my 401k at $15k this year"
//      - Per-tax-type: "cap all Roth contributions at $20k"
//      The more restrictive cap always wins. When a cap is hit, excess
//      flows to the next account (waterfall) or redistributes (percentage).
//
// 6. OVERFLOW — When an account can't absorb more money:
//    • Waterfall mode: excess flows to the next account in priority order
//    • Percentage mode: excess redistributes proportionally to remaining
//      accounts, then to brokerage as the final catch-all
//    The UI highlights every year where overflow/redistribution occurs.
//
// 7. UI VIEWS — The same override data supports two views:
//    • "By lever" — see all rate changes, all priority changes, etc.
//      Good for tweaking one setting across time.
//    • "By year"  — see the full resolved config for each year.
//      Good for understanding "what's happening in 2035?"
//    Both views read/write the same AccumulationOverride[] array.
//
// ============================================================================

/**
 * How contributions are distributed across account categories.
 *
 * **Waterfall mode** (default): Contributions fill the highest-priority account
 * first, up to its limit (IRS or artificial cap), then overflow to the next.
 * Best when you want to maximize tax-advantaged space before using brokerage.
 *
 * **Percentage mode**: Contributions are split across accounts by a fixed %.
 * If a percentage allocation exceeds an account's limit, the excess
 * redistributes proportionally to the remaining accounts.
 * Best when you want explicit control over how much goes where.
 */
export type RoutingMode = "waterfall" | "percentage" | "bracket_filling";

/**
 * Tax treatment types for contribution/distribution routing.
 *
 * Only applies to 401k and IRA — the two account types that offer a choice.
 * HSA is always pre-tax (similar to traditional but with unique tax benefits).
 * Brokerage is always after-tax (no special tax treatment on contributions).
 */
export type RoutingTaxType = "traditional" | "roth";

/**
 * Per-account Roth fraction (0–1) for accounts that support tax treatment choice.
 *
 * - Value of 0 = 100% Traditional (all contributions are pre-tax)
 * - Value of 1 = 100% Roth (all contributions are after-tax, grow tax-free)
 * - Value of 0.7 = 70% Roth / 30% Traditional
 *
 * Only 401k and IRA have configurable splits:
 * - HSA is always pre-tax (not configurable here)
 * - Brokerage is always after-tax (not configurable here)
 *
 * Example: { '401k': 0.7, ira: 1.0 }
 *   → 401k gets 70% Roth / 30% Traditional
 *   → IRA gets 100% Roth
 */
export type TaxSplitConfig = Partial<Record<AccountCategory, number>>;

// --- Accumulation (saving / contributing) ---

/**
 * Page-level defaults for accumulation — the "Projection Assumptions" baseline.
 * These are the values used when no year-specific override is active.
 * Every field here has a corresponding optional field in AccumulationOverride.
 */
export type AccumulationDefaults = {
  /**
   * Target contribution rate as decimal (e.g. 0.25 = 25% of gross salary).
   * This is the total percentage of salary you want to save/invest each year.
   */
  contributionRate: number;

  /**
   * How to route contributions across accounts.
   * 'waterfall' = fill in priority order; 'percentage' = split by %.
   */
  routingMode: RoutingMode;

  /**
   * Account priority order for waterfall mode.
   * The first account in the list fills first, then the next, etc.
   * Brokerage should usually be last (it's the unlimited overflow catch-all).
   *
   * Example: ['401k', 'hsa', 'ira', 'brokerage']
   *   → Max out 401k first, then HSA, then IRA, remainder to brokerage.
   */
  accountOrder: AccountCategory[];

  /**
   * Percentage splits for percentage mode. Values must sum to 1.0.
   * Each value is the fraction of the total contribution going to that account.
   *
   * Example: { '401k': 0.60, hsa: 0.15, ira: 0.15, brokerage: 0.10 }
   *   → 60% of contributions to 401k, 15% to HSA, 15% to IRA, 10% to brokerage.
   *
   * If a percentage allocation exceeds an account's IRS limit, the excess
   * redistributes proportionally to the remaining accounts.
   */
  accountSplits: Record<AccountCategory, number>;

  /**
   * Default Roth/Traditional split for 401k and IRA.
   * See TaxSplitConfig for how the fraction works.
   *
   * Example: { '401k': 1.0, ira: 1.0 } → all Roth by default
   */
  taxSplits: TaxSplitConfig;
};

/**
 * A single year-override entry for the accumulation phase.
 *
 * HOW OVERRIDES WORK:
 * - Each field is optional — only set the fields you want to change.
 * - Fields you don't set keep their previous value (sticky-forward).
 * - Multiple overrides can exist for different years.
 * - The engine processes overrides in year order, carrying forward each field.
 *
 * EXAMPLES:
 *
 * Change just the contribution rate in 2028:
 *   { year: 2028, contributionRate: 0.30 }
 *   → Rate becomes 30% from 2028 onward. All other settings unchanged.
 *
 * Switch to percentage mode and change tax splits in 2030:
 *   { year: 2030, routingMode: 'percentage',
 *     accountSplits: { '401k': 0.5, hsa: 0.2, ira: 0.2, brokerage: 0.1 },
 *     taxSplits: { '401k': 0.5, ira: 1.0 } }
 *   → From 2030: percentage mode, 50/50 Roth/Trad in 401k, all Roth IRA.
 *
 * Cap 401k contributions at $15k in 2029:
 *   { year: 2029, accountCaps: { '401k': 15000 } }
 *   → 401k limited to $15k (below IRS limit). Excess overflows per routing mode.
 *
 * Reset everything back to defaults in 2035:
 *   { year: 2035, reset: true }
 *   → All fields revert to AccumulationDefaults values from 2035 onward.
 */
export type AccumulationOverride = {
  year: number;

  /** Target contribution rate as decimal. See AccumulationDefaults.contributionRate. */
  contributionRate?: number;

  /** Routing mode. See AccumulationDefaults.routingMode. */
  routingMode?: RoutingMode;

  /**
   * Account priority order for waterfall mode.
   * Only meaningful when routingMode is 'waterfall'.
   */
  accountOrder?: AccountCategory[];

  /**
   * Percentage splits for percentage mode. Values should sum to 1.0.
   * Only meaningful when routingMode is 'percentage'.
   */
  accountSplits?: Partial<Record<AccountCategory, number>>;

  /**
   * Roth fraction overrides for 401k and/or IRA.
   * Partial — only set the accounts whose split you want to change.
   */
  taxSplits?: Partial<TaxSplitConfig>;

  /**
   * Artificial dollar cap per account type for this year.
   * Caps are BELOW IRS limits — the more restrictive cap wins.
   * Set a value to cap; omit an account to leave it uncapped.
   *
   * Example: { '401k': 15000 } → cap 401k at $15k, others use IRS limits.
   */
  accountCaps?: Partial<Record<AccountCategory, number>>;

  /**
   * Cross-account dollar cap per tax type.
   * Limits total Roth or Traditional contributions across ALL accounts.
   * The more restrictive of (account cap, tax-type cap) wins.
   *
   * Example: { roth: 20000 } → total Roth across 401k+IRA capped at $20k.
   */
  taxTypeCaps?: Partial<Record<RoutingTaxType, number>>;

  /**
   * One-time dollar injections for this year. NOT sticky-forward.
   * Bypasses IRS contribution limits (models rollovers, inheritances, windfalls).
   */
  lumpSums?: LumpSum[];

  /**
   * When true, ALL fields revert to AccumulationDefaults from this year onward.
   * Any other fields set in the same override are ignored when reset is true.
   */
  reset?: boolean;

  /** Optional note explaining why this override exists (shown in UI tooltip). */
  notes?: string;
};

/**
 * The fully resolved accumulation config for a single year.
 * Computed by the engine after applying all sticky-forward overrides.
 * Every field is non-optional — all values are known.
 */
export type ResolvedAccumulationConfig = {
  contributionRate: number;
  routingMode: RoutingMode;
  accountOrder: AccountCategory[];
  accountSplits: Record<AccountCategory, number>;
  taxSplits: TaxSplitConfig;
  /** null = no artificial cap (IRS limit only). */
  accountCaps: Record<AccountCategory, number | null>;
  /** null = no cross-account tax-type cap. */
  taxTypeCaps: Record<RoutingTaxType, number | null>;
  /** Lump sums for this year only (NOT sticky-forward). Empty if none. */
  lumpSums: LumpSum[];
};

// --- Decumulation (withdrawing / distributing) ---

/**
 * Page-level defaults for decumulation — the baseline withdrawal strategy.
 *
 * Decumulation is the reverse of accumulation: instead of routing contributions
 * INTO accounts, you're routing withdrawals OUT OF accounts.
 *
 * The same override system applies: any setting can change at any year,
 * with sticky-forward persistence.
 */
export type DecumulationDefaults = {
  /**
   * Withdrawal rate as decimal (e.g. 0.04 = 4% rule).
   * Applied to total portfolio to determine annual withdrawal target.
   */
  withdrawalRate: number;

  /**
   * How to route withdrawals across accounts.
   * - 'bracket_filling': fill traditional withdrawals up to a target tax bracket,
   *   then Roth for remainder, brokerage as overflow, HSA last. Tax-optimal default.
   *   Requires taxBrackets in distributionTaxRates; falls back to waterfall if missing.
   * - 'waterfall': drain accounts in priority order (withdrawalOrder).
   * - 'percentage': split withdrawals by fixed % (withdrawalSplits).
   *   If a split requests more than available, excess redistributes proportionally.
   */
  withdrawalRoutingMode: RoutingMode;

  /**
   * Account withdrawal priority — which accounts to draw from first.
   * Only used when withdrawalRoutingMode = 'waterfall'.
   * Typically: brokerage first (taxable), then traditional (tax-deferred),
   * then Roth last (let tax-free growth compound longest).
   *
   * Example: ['brokerage', '401k', 'ira', 'hsa']
   *   → Draw from brokerage first, then 401k, then IRA, then HSA last.
   */
  withdrawalOrder: AccountCategory[];

  /**
   * Fixed percentage split for withdrawals across accounts.
   * Only used when withdrawalRoutingMode = 'percentage'.
   * Values should sum to 1.0 (100%). If an account has insufficient
   * funds, its shortfall redistributes proportionally to others.
   *
   * Example: { brokerage: 0.5, '401k': 0.3, ira: 0.15, hsa: 0.05 }
   */
  withdrawalSplits: Record<AccountCategory, number>;

  /**
   * Per-account: which tax type to draw from first WITHIN that account.
   * For 401k and IRA, you may have both Traditional and Roth balances.
   * This controls which bucket depletes first within each account.
   *
   * Example: { '401k': 'traditional', ira: 'traditional' }
   *   → Draw Traditional 401k before Roth 401k; Traditional IRA before Roth IRA.
   *   → This lets Roth balances grow tax-free longer.
   *
   * HSA and Brokerage only have one tax type, so they're ignored here.
   */
  withdrawalTaxPreference: Partial<Record<AccountCategory, RoutingTaxType>>;

  /**
   * Distribution tax configuration.
   *
   * When `taxBrackets` are provided, the engine estimates the effective federal
   * income tax rate on traditional withdrawals per year using actual bracket data
   * from the DB (based on the person's filing status). The `taxMultiplier` scales
   * the result for future rate uncertainty (1.0 = current law).
   *
   * If brackets are not provided, `traditionalFallbackRate` is used as a flat haircut.
   *
   * - roth: 0% — qualified Roth withdrawals are tax-free
   * - hsa: 0% — qualified HSA withdrawals are tax-free
   * - brokerage: long-term capital gains rate (default 0.15)
   */
  distributionTaxRates: {
    traditionalFallbackRate: number;
    roth: number;
    hsa: number;
    brokerage: number;
    /** W-4 withholding brackets (from DB, person's filing status), sorted by threshold ascending. */
    taxBrackets?: {
      threshold: number;
      baseWithholding: number;
      rate: number;
    }[];
    /** Multiplier on computed tax (1.0 = current law, 0.8 = 20% lower). Default 1.0. */
    taxMultiplier?: number;
    /**
     * When true (default), the engine increases withdrawals to cover taxes so
     * after-tax proceeds meet expenses. When false, withdrawals equal the raw
     * expense need — tax cost is still calculated and reported but not grossed up.
     */
    grossUpForTaxes?: boolean;
    /**
     * Target marginal tax rate for Roth optimization (e.g. 0.12 = 12% bracket).
     * When set, the engine caps traditional withdrawals at the bracket threshold
     * for this rate, filling remaining need from Roth to minimize the tax bill.
     * Undefined = disabled (no Roth optimization).
     */
    rothBracketTarget?: number;
    /** Enable automatic Roth conversions (Traditional → Roth) to fill target bracket. */
    enableRothConversions?: boolean;
    /** Target marginal rate for Roth conversions (null/undefined = use rothBracketTarget). */
    rothConversionTarget?: number;
  };

  /** Withdrawal/spending strategy. Defaults to 'fixed'. */
  withdrawalStrategy?: WithdrawalStrategyType;

  /**
   * Strategy-specific parameters. Keyed by strategy type.
   * Only the active strategy's params are read at runtime.
   * Each value is a record of param name → number | boolean (matching the
   * strategy registry's `paramFields`).
   */
  strategyParams?: Partial<
    Record<WithdrawalStrategyType, Record<string, number | boolean>>
  >;
};

/**
 * A single year-override entry for the decumulation phase.
 * Same sticky-forward semantics as AccumulationOverride.
 *
 * EXAMPLES:
 *
 * Reduce withdrawal rate at age 75 (year 2062):
 *   { year: 2062, withdrawalRate: 0.035 }
 *   → Drop to 3.5% withdrawal from 2062 onward.
 *
 * Switch to drawing Roth first from 401k at age 80:
 *   { year: 2067, withdrawalTaxPreference: { '401k': 'roth' } }
 *   → Start drawing Roth 401k before Traditional 401k.
 *
 * Cap annual brokerage withdrawals at $50k:
 *   { year: 2060, withdrawalAccountCaps: { brokerage: 50000 } }
 *   → No more than $50k/year from brokerage; excess need from other accounts.
 */
export type DecumulationOverride = {
  year: number;

  /** Withdrawal rate as decimal. See DecumulationDefaults.withdrawalRate. */
  withdrawalRate?: number;

  /** Withdrawal routing mode. See DecumulationDefaults.withdrawalRoutingMode. */
  withdrawalRoutingMode?: RoutingMode;

  /** Account withdrawal priority (waterfall mode). See DecumulationDefaults.withdrawalOrder. */
  withdrawalOrder?: AccountCategory[];

  /** Fixed percentage split (percentage mode). See DecumulationDefaults.withdrawalSplits. */
  withdrawalSplits?: Partial<Record<AccountCategory, number>>;

  /**
   * Per-account tax preference for withdrawals.
   * See DecumulationDefaults.withdrawalTaxPreference.
   */
  withdrawalTaxPreference?: Partial<Record<AccountCategory, RoutingTaxType>>;

  /**
   * Dollar cap on withdrawals per account per year.
   * Limits how much can be drawn from a single account type.
   * Excess withdrawal need shifts to the next account in withdrawalOrder.
   */
  withdrawalAccountCaps?: Partial<Record<AccountCategory, number>>;

  /**
   * Cross-account dollar cap per tax type for withdrawals.
   * Limits total Traditional or Roth withdrawals across all accounts.
   *
   * Example: { traditional: 80000 } → draw no more than $80k/year from
   * Traditional balances (across 401k + IRA), to stay in a lower tax bracket.
   */
  withdrawalTaxTypeCaps?: Partial<Record<RoutingTaxType, number>>;

  /**
   * Override the Roth conversion target bracket for this year onward.
   * Set to 0 to disable Roth conversions from this year.
   * Omit to keep the current target.
   */
  rothConversionTarget?: number;

  /**
   * One-time dollar withdrawals for this year. NOT sticky-forward.
   * Models windfall spending, one-time distributions, etc.
   */
  lumpSums?: LumpSum[];

  /**
   * When true, ALL decumulation fields revert to DecumulationDefaults.
   */
  reset?: boolean;

  /** Optional note explaining why this override exists (shown in UI tooltip). */
  notes?: string;
};

/**
 * The fully resolved decumulation config for a single year.
 * Computed by the engine after applying all sticky-forward overrides.
 */
export type ResolvedDecumulationConfig = {
  withdrawalRate: number;
  withdrawalRoutingMode: RoutingMode;
  withdrawalOrder: AccountCategory[];
  withdrawalSplits: Record<AccountCategory, number>;
  withdrawalTaxPreference: Record<AccountCategory, RoutingTaxType | null>;
  /** null = no artificial cap on withdrawals from this account. */
  withdrawalAccountCaps: Record<AccountCategory, number | null>;
  /** null = no cross-account tax-type cap on withdrawals. */
  withdrawalTaxTypeCaps: Record<RoutingTaxType, number | null>;
  /** Resolved Roth conversion target marginal rate (sticky-forward from overrides). undefined = use defaults. */
  rothConversionTarget?: number;
  /** Lump sums for this year only (NOT sticky-forward). Empty if none. */
  lumpSums: LumpSum[];
};

/**
 * Per-account contribution spec derived from paycheck/contributions DB data.
 * The engine uses these to project contributions per-account for years 1+,
 * respecting each account's contribution method and IRS limits.
 */
export type ContributionSpec = {
  /** Waterfall category this account maps to. */
  category: AccountCategory;
  /** Human-readable account name (e.g. "401k", "ESPP", "HSA"). */
  name: string;
  /** How contributions are defined. */
  method: "percent_of_salary" | "fixed_per_period" | "fixed_monthly";
  /** The contribution value: percentage (as decimal, e.g. 0.16 = 16%) for
   *  percent_of_salary, or dollar amount per period/month for fixed methods. */
  value: number;
  /** Fraction of total compensation this spec's job represents (0–1).
   *  For percent_of_salary: engine computes `projectedSalary × salaryFraction × value`
   *  so that multi-job households don't inflate per-account contributions.
   *  Defaults to 1.0 for single-job households. */
  salaryFraction: number;
  /** Periods per year (for fixed_per_period). Ignored for other methods. */
  periodsPerYear?: number;
  /** Current-year annual contribution (computed from value + salary/periods). */
  baseAnnual: number;
  /** Tax treatment of employee contributions. */
  taxTreatment: "pre_tax" | "tax_free" | "after_tax" | "hsa";
  /** Person who owns this contribution (for per-person salary tracking). */
  personId?: number;
  /** Owner name for matching to individual accounts. */
  ownerName?: string;
  /** Matched individual account display name (data-driven from DB). */
  accountName?: string;
  /** User's self-imposed annual contribution target (null = no cap). */
  targetAnnual?: number | null;
  /** Overflow allocation priority (lower = higher priority, 0 = default). */
  allocationPriority?: number;
  /** Parent category from contribution account config (e.g. "Retirement", "Portfolio"). */
  parentCategory?: string;
};

// --- Engine Input ---

/**
 * Full input for the contribution/distribution engine.
 *
 * Full input with granular control over routing, tax splits, caps, and overrides.
 * The engine projects accumulation (pre-retirement) and decumulation
 * (post-retirement) in a single pass.
 *
 * USAGE:
 * 1. Set page-level defaults in accumulationDefaults / decumulationDefaults.
 *    These come from the "Projection Assumptions" card.
 * 2. Add year-specific overrides to accumulationOverrides / decumulationOverrides.
 *    Each override only needs to specify the fields that change.
 * 3. The engine resolves the full config per year (sticky-forward per field)
 *    and routes money accordingly.
 */
/** A mid-projection contribution profile switch entry.
 *  Contains the contribution structure to swap in at the target year.
 *  Salary overrides from profiles are handled separately via perPersonSalaryOverrides. */
export type ProfileSwitch = {
  year: number;
  contributionSpecs: ContributionSpec[];
  employerMatchRateByCategory: Record<AccountCategory, number>;
  /** Base-year contributions per category. Used for year-0 real-contrib path
   *  and brokerage intentional-contribution detection in all years. */
  baseYearContributions: Record<AccountCategory, number>;
  baseYearEmployerMatch: Record<AccountCategory, number>;
  employerMatchByParentCat?: Map<AccountCategory, Map<string, number>>;
  /** Contribution rate ceiling derived from this profile's total contributions / compensation. */
  contributionRate: number;
};

export type ProjectionInput = {
  // --- Defaults (from Projection Assumptions) ---
  accumulationDefaults: AccumulationDefaults;
  decumulationDefaults: DecumulationDefaults;

  // --- Per-year overrides ---
  /**
   * Accumulation overrides, sorted by year. Each entry's fields are
   * sticky-forward (persist until the next override for that field).
   * Used during years where age < retirementAge.
   */
  accumulationOverrides: AccumulationOverride[];

  /**
   * Decumulation overrides, sorted by year. Same sticky-forward semantics.
   * Used during years where age >= retirementAge.
   */
  decumulationOverrides: DecumulationOverride[];

  // --- Person / salary ---
  currentAge: number;
  retirementAge: number;
  /** End of projection (e.g. age 95). */
  projectionEndAge: number;
  currentSalary: number;
  salaryGrowthRate: number;
  salaryCap: number | null;
  salaryOverrides: RetirementYearOverride[];
  /** Per-person starting salaries (personId → annual salary).
   *  When provided, the engine tracks each person's salary independently,
   *  allowing per-person salary overrides to affect only that person's
   *  contribution specs. The combined total equals currentSalary. */
  salaryByPerson?: Record<number, number>;
  /** Per-person salary overrides. Each entry overrides a specific person's
   *  salary for a given year. Takes precedence over salaryOverrides (which
   *  are household-level). Sticky-forward per person. */
  perPersonSalaryOverrides?: {
    personId: number;
    year: number;
    value: number;
  }[];
  /** Per-year budget overrides (monthly budget in dollars). Sticky-forward. */
  budgetOverrides: RetirementYearOverride[];

  // --- IRS limits ---
  /** Per-category base IRS limits for the current year (no catchup). */
  baseLimits: Record<AccountCategory, number>;
  /** How fast IRS limits grow annually (e.g. 0.02 = 2%/year). */
  limitGrowthRate: number;
  /**
   * Catchup contribution limits keyed by IRS limit group.
   * The engine adds these to baseLimits in years where the person qualifies by age:
   *   - Standard catchup (age >= 50): keyed by limit group (e.g. '401k', 'ira')
   *   - HSA catchup (age >= 55): keyed by 'hsa'
   *   - Super-catchup (SECURE 2.0, ages 60–63): keyed as '{group}_super' (e.g. '401k_super')
   * All amounts grow at limitGrowthRate alongside base limits.
   */
  catchupLimits?: Record<string, number>;

  // --- Employer match ---
  /** Employer match as rate of salary per category (for salary-linked growth). */
  employerMatchRateByCategory: Record<AccountCategory, number>;
  /** Employer match broken down by category → parentCategory → amount.
   *  Used to distribute match only to individual accounts from the correct parentCategory. */
  employerMatchByParentCat?: Map<AccountCategory, Map<string, number>>;

  // --- Per-account contribution specs (from paycheck/contributions page) ---
  /**
   * Per-account contribution definitions from the DB.  When provided, years 1+
   * compute contributions per-account instead of using a single blended
   * `contributionRate × salary` routed via waterfall.
   *
   * - `percent_of_salary` accounts scale with projected salary growth
   * - `fixed_per_period` / `fixed_monthly` accounts scale with IRS limit growth
   * - Tax-advantaged accounts are capped at projected IRS limits; overflow goes to brokerage
   * - Brokerage / ESPP accounts have no IRS cap
   */
  contributionSpecs?: ContributionSpec[];

  /**
   * Mid-projection contribution profile switches. When a user selects a
   * different contribution profile for a future year, the engine swaps in
   * that profile's full contribution structure (specs, employer match).
   * Salary overrides from profiles are fed into perPersonSalaryOverrides
   * by the router — the engine handles them via the existing salary mechanism.
   * Sorted by year ascending.
   */
  profileSwitches?: ProfileSwitch[];

  // --- Real contribution amounts for base year ---
  /** Actual per-category contributions from paycheck data. Used for year 0
   *  instead of salary × rate, which can create artificial overflow when
   *  the blended rate + waterfall doesn't match granular account elections. */
  baseYearContributions?: Record<AccountCategory, number>;
  /** Actual per-category employer match amounts for the base year. */
  baseYearEmployerMatch?: Record<AccountCategory, number>;

  // --- Brokerage contribution ramp ---
  /** Annual increase to brokerage contributions ($X/year). Year N gets +ramp×N added. */
  brokerageContributionRamp?: number;

  // --- Brokerage goals (pre-retirement withdrawals) ---
  /** Brokerage goals with planned withdrawal years — processed during accumulation. */
  brokerageGoals?: {
    id: number;
    name: string;
    targetAmount: number;
    targetYear: number;
    priority: number;
  }[];

  // --- Starting balances (for decumulation projection) ---
  /** Starting portfolio balances per tax bucket (includes afterTaxBasis for cost basis tracking). */
  startingBalances: TaxBuckets;
  /** Per-account starting balances (401k/IRA split). When provided, the engine
   *  tracks per-account balances through both phases instead of using a heuristic
   *  70/30 split during decumulation. Built from portfolio_accounts snapshot. */
  startingAccountBalances?: AccountBalances;

  /** Individual account starting balances from portfolio snapshot.
   *  When provided, the engine tracks each named account separately through
   *  both phases, routing contributions via spec name matching and applying
   *  growth per-account. This enables exact per-account tooltips. */
  individualAccounts?: IndividualAccountInput[];

  // --- Expenses & return rates ---
  annualExpenses: number;
  /** Expense growth rate during accumulation (pre-retirement). */
  inflationRate: number;
  /** Expense growth rate during decumulation (post-retirement).
   *  Typically higher than pre-retirement due to healthcare costs.
   *  Falls back to inflationRate if not provided. */
  postRetirementInflationRate?: number;
  /** Age-indexed return rates (from return_rate_table). */
  returnRates: { label: string; rate: number }[];
  /** Social Security annual income (kicks in at ssStartAge). */
  socialSecurityAnnual: number;
  /** Age at which Social Security income begins (default 67). */
  ssStartAge: number;
  /** Birth year of primary person — used for RMD start age (SECURE 2.0).
   *  When omitted, RMDs are not enforced (backward-compatible). */
  birthYear?: number;
  /** Filing status — used for accurate SS taxation and LTCG brackets.
   *  When omitted, falls back to flat 85% SS taxation and flat LTCG rate. */
  filingStatus?: FilingStatusType;
  /** Enable IRMAA awareness — report Medicare surcharge cliffs (65+). */
  enableIrmaaAwareness?: boolean;
  /** When true, cap Roth conversions to stay below the next IRMAA cliff (default: true when IRMAA awareness is on). */
  irmaaAwareRothConversions?: boolean;
  /** When true, reinvest RMD excess above G-K spending need into brokerage (default: true). */
  reinvestRmdExcess?: boolean;
  /** Enable ACA subsidy awareness — cap MAGI to preserve health insurance subsidies (pre-65). */
  enableAcaAwareness?: boolean;
  /** Household size for ACA FPL calculation (default 2). */
  householdSize?: number;
  /** Per-person birth years for age-gated checks (IRMAA at 65+, ACA below 65).
   *  IRMAA applies when ANY person is ≥65; ACA applies when ALL persons are <65.
   *  Falls back to deriving age from `currentAge` if not provided. */
  perPersonBirthYears?: number[];
  /** Annual expenses for decumulation phase. When set, projectedExpenses resets to this value at retirement age. */
  decumulationAnnualExpenses?: number;
  asOfDate: Date;
};

// --- Engine Output ---

/**
 * Per-account slot showing how contributions were routed for one year.
 * Per-account slot with tax treatment breakdown and cap info.
 */
export type AccumulationSlot = {
  category: AccountCategory;
  /** IRS limit for this account this year (0 for brokerage). */
  irsLimit: number;
  /**
   * The actual limit used after applying artificial caps.
   * effectiveLimit = min(irsLimit, accountCap ?? Infinity).
   * For brokerage: always Infinity (no limit).
   */
  effectiveLimit: number;
  /** Employer match flowing into this account (doesn't count toward limits). */
  employerMatch: number;
  /** Total employee contribution routed to this account. */
  employeeContrib: number;
  /** Roth portion of employee contribution (only for 401k/IRA). */
  rothContrib: number;
  /** Traditional portion of employee contribution (only for 401k/IRA). */
  traditionalContrib: number;
  /** How much effective limit space remains after employee contribution. */
  remainingSpace: number;
  /** True if the artificial account cap was the binding constraint (not IRS limit). */
  cappedByAccount: boolean;
  /** True if a cross-account tax-type cap reduced contributions to this account. */
  cappedByTaxType: boolean;
  /** Amount that couldn't fit here and was sent to the next account. */
  overflowAmount: number;
};

/**
 * Per-account slot showing how withdrawals were drawn for one year.
 */
export type DecumulationSlot = {
  category: AccountCategory;
  /** Total amount withdrawn from this account. */
  withdrawal: number;
  /** Roth portion of withdrawal (only for 401k/IRA). */
  rothWithdrawal: number;
  /** Traditional portion of withdrawal (only for 401k/IRA). */
  traditionalWithdrawal: number;
  /** True if the artificial account cap was the binding constraint. */
  cappedByAccount: boolean;
  /** True if a cross-account tax-type cap limited withdrawals from this account. */
  cappedByTaxType: boolean;
  /** Amount that couldn't be drawn here and shifts to the next account. */
  remainingNeed: number;
  /** For brokerage: portion of withdrawal that is return of basis (tax-free). */
  basisPortion?: number;
  /** For brokerage: portion of withdrawal that is taxable gain. */
  gainsPortion?: number;
};

/**
 * Year projection for the accumulation phase (pre-retirement).
 */
export type EngineAccumulationYear = {
  year: number;
  age: number;
  phase: "accumulation";
  projectedSalary: number;
  /** Per-person salary breakdown (personId → projected salary). Only present when per-person tracking is active. */
  projectedSalaryByPerson?: Record<number, number>;
  /** Projected annual expenses (inflated or budget-overridden). */
  projectedExpenses: number;
  hasSalaryOverride: boolean;
  hasBudgetOverride: boolean;
  /** Pro-rate fraction for year 0 (e.g. 0.833 = 10 of 12 months remaining). null for full years. */
  proRateFraction: number | null;
  /** Total target contribution (salary × effective contribution rate). */
  targetContribution: number;
  /** The fully resolved config that was used for this year. */
  config: ResolvedAccumulationConfig;
  /** Per-account routing breakdown. */
  slots: AccumulationSlot[];
  /** Total employee contributions across all accounts. */
  totalEmployee: number;
  /** Total employer match across all accounts. */
  totalEmployer: number;
  /** Total Roth contributions across all accounts. */
  totalRoth: number;
  /** Total Traditional contributions across all accounts. */
  totalTraditional: number;
  /** Scale factor applied by the contribution rate ceiling (1 = no cap, <1 = capped). null when no ceiling applied. */
  rateCeilingScale: number | null;
  /** Amount that overflowed to brokerage (beyond tax-advantaged space). */
  overflowToBrokerage: number;
  /** Additional brokerage contribution from annual ramp ($X × year index). */
  brokerageRampContribution: number;
  /** Total IRS-limited space this year. */
  totalTaxAdvSpace: number;
  /** Brokerage goal withdrawals processed this year (during accumulation). */
  brokerageGoalWithdrawals: {
    goalId: number;
    name: string;
    amount: number;
    basisPortion: number;
    gainsPortion: number;
    taxCost: number;
  }[];
  /** Portfolio balance at end of year (all buckets combined). */
  endBalance: number;
  /** Balance breakdown by tax bucket. */
  balanceByTaxType: TaxBuckets;
  /** Balance breakdown by account category (401k/IRA split tracked separately). */
  balanceByAccount: AccountBalances;
  /** Per-individual-account balances (exact, tracked through engine). Empty if individualAccounts not provided. */
  individualAccountBalances: IndividualAccountYearBalance[];
  /** The return rate applied this year (effective, after pro-rating for year 0). */
  returnRate: number;
  /** The annualized return rate (compound-derived from partial-year return for year 0, otherwise same as returnRate). */
  annualizedReturnRate: number;
  /** Per-year warnings (cap hits, overflow, redistribution). */
  warnings: string[];
};

/**
 * Year projection for the decumulation phase (post-retirement).
 */
export type EngineDecumulationYear = {
  year: number;
  age: number;
  phase: "decumulation";
  /** Projected annual expenses (inflated or budget-overridden). */
  projectedExpenses: number;
  hasBudgetOverride: boolean;
  /** Target annual withdrawal (portfolio × withdrawal rate). */
  targetWithdrawal: number;
  /** The fully resolved config that was used for this year. */
  config: ResolvedDecumulationConfig;
  /** Per-account withdrawal breakdown. */
  slots: DecumulationSlot[];
  /** Total amount withdrawn across all accounts. */
  totalWithdrawal: number;
  /** Total Roth withdrawals (tax-free). */
  totalRothWithdrawal: number;
  /** Total Traditional withdrawals (taxable). */
  totalTraditionalWithdrawal: number;
  /** Estimated tax cost on this year's withdrawals (traditional × trad rate + brokerage × brokerage rate). */
  taxCost: number;
  /** Bracket-estimated effective tax rate on this year's withdrawals (0–1). */
  effectiveTaxRate: number;
  // --- Diagnostic fields (for debugging withdrawal calculations) ---
  /** Social Security income for this year (0 if not yet started). */
  ssIncome: number;
  /** After-tax expense need (projectedExpenses - ssIncome). */
  afterTaxNeed: number;
  /** Gross-up multiplier: 1 / (1 - effectiveTaxRate). */
  grossUpFactor: number;
  /** Fraction of portfolio in pre-tax accounts (drives tax rate weighting). */
  estTraditionalPortion: number;
  /** Debug: bracket-filling traditional cap (income cap - taxable SS). */
  bracketTraditionalCap?: number;
  /** Debug: unmet withdrawal need after routing (target - actual). */
  unmetNeed?: number;
  /** Debug: pre-withdrawal per-account balances (what the router sees). */
  preWithdrawalAcctBal?: AccountBalances;
  /** Portfolio balance at end of year (all buckets combined). */
  endBalance: number;
  /** Balance breakdown by tax bucket. */
  balanceByTaxType: TaxBuckets;
  /** Balance breakdown by account category (401k/IRA split tracked separately). */
  balanceByAccount: AccountBalances;
  /** Per-individual-account balances (exact, tracked through engine). Empty if individualAccounts not provided. */
  individualAccountBalances: IndividualAccountYearBalance[];
  /** The return rate applied this year. */
  returnRate: number;
  /** The annualized return rate (same as returnRate in decumulation — no pro-rating). */
  annualizedReturnRate: number;
  // --- RMD fields (Phase 1) ---
  /** Required Minimum Distribution amount for this year (0 if not applicable). */
  rmdAmount: number;
  /** True if the RMD forced additional Traditional withdrawals beyond what routing chose. */
  rmdOverrodeRouting: boolean;
  // --- SS Tax fields (Phase 2) ---
  /** Taxable portion of Social Security income (IRS provisional income formula). */
  taxableSS: number;
  // --- LTCG fields (Phase 3) ---
  /** Effective LTCG tax rate used for brokerage withdrawals this year (0%, 15%, or 20%). */
  ltcgRate: number;
  // --- Roth Conversion fields (Phase 4) ---
  /** Amount converted from Traditional → Roth this year. */
  rothConversionAmount: number;
  /** Tax cost of the Roth conversion (paid from portfolio). */
  rothConversionTaxCost: number;
  // --- Spending strategy fields (Phase 5) ---
  /** Strategy action taken this year (e.g. 'increase', 'decrease', 'skip_inflation', 'floor_applied'). */
  strategyAction: string | null;
  // --- NIIT (Net Investment Income Tax, 3.8% surtax) ---
  /** NIIT amount: 3.8% × min(net investment income, MAGI - threshold). 0 if below threshold. */
  niitAmount: number;
  // --- IRMAA fields (Phase 6) ---
  /** Annual IRMAA surcharge cost (per person, age 65+). 0 if below threshold or awareness disabled. */
  irmaaCost: number;
  // --- ACA fields (Phase 7) ---
  /** Whether ACA subsidy was preserved this year (MAGI kept below cliff). */
  acaSubsidyPreserved: boolean;
  /** MAGI headroom below ACA cliff ($0 if not applicable). */
  acaMagiHeadroom: number;
  /** Per-year warnings (cap hits, insufficient funds, etc.). */
  warnings: string[];
};

/** A single year in the engine projection — either accumulation or decumulation. */
export type EngineYearProjection =
  | EngineAccumulationYear
  | EngineDecumulationYear;

/**
 * Full result from the contribution/distribution engine.
 */
export type ProjectionResult = {
  /** Year-by-year projection covering accumulation + decumulation. */
  projectionByYear: EngineYearProjection[];
  /** The first year where overflow to brokerage occurs during accumulation. */
  firstOverflowYear: number | null;
  firstOverflowAge: number | null;
  firstOverflowAmount: number | null;
  /** The year the portfolio is projected to run out (null if it never does). */
  portfolioDepletionYear: number | null;
  portfolioDepletionAge: number | null;
  /** Sustainable annual withdrawal at retirement (portfolio × withdrawal rate). */
  sustainableWithdrawal: number;
  /** Per-account depletion tracking: first year each account category hits zero. */
  accountDepletions: {
    category: AccountCategory;
    subType?: "traditional" | "roth";
    depletionYear: number;
    depletionAge: number;
  }[];
  warnings: string[];
};

// --- Relocation Decision Tool ---

/** Year-specific expense adjustment for relocation analysis. */
export type RelocationYearAdjustment = {
  year: number;
  /** Monthly expense override for the relocation scenario in that year. When using a budget profile, this is resolved server-side. */
  monthlyExpenses: number;
  /** Optional budget profile ID — when set, monthlyExpenses is resolved from this profile+column server-side. */
  profileId?: number;
  /** Budget column index within the profile. Required when profileId is set. */
  budgetColumn?: number;
  notes?: string;
};

/** Year-specific contribution rate override for relocation analysis. */
export type RelocationContributionOverride = {
  year: number;
  /** Contribution rate as decimal (e.g. 0.25 = 25% of salary). Applies from this year onward until the next override. */
  rate: number;
  notes?: string;
};

/** A large one-time or financed purchase tied to the relocation scenario (home, car, furniture, etc.). */
export type RelocationLargePurchase = {
  name: string;
  purchasePrice: number;
  /** Down payment as decimal (0.20 = 20%). If absent or 1, purchase is all-cash. */
  downPaymentPercent?: number;
  /** Annual interest rate for financed portion (e.g. 0.065 = 6.5%). */
  loanRate?: number;
  /** Loan term in years (e.g. 30). */
  loanTermYears?: number;
  /** Ongoing monthly costs added to relocation expenses from purchase year onward (property tax, HOA, insurance, maintenance, etc.). */
  ongoingMonthlyCost?: number;
  /** Net proceeds from selling an existing asset (e.g. current home equity minus fees). Added to portfolio in purchase year. */
  saleProceeds?: number;
  /** Calendar year of purchase. */
  purchaseYear: number;
};

export type RelocationInput = {
  /** Current monthly expenses (from active budget column). */
  currentMonthlyExpenses: number;
  /** Relocation monthly expenses (from selected budget column). */
  relocationMonthlyExpenses: number;
  /** Year-specific overrides to relocation expenses (phase-in, cost cuts, etc.). */
  yearAdjustments: RelocationYearAdjustment[];
  /** Year-specific contribution rate overrides (% of salary). Each applies from that year onward until the next override. */
  contributionOverrides: RelocationContributionOverride[];
  /** Large purchases tied to the relocation (home, car, etc.). */
  largePurchases: RelocationLargePurchase[];
  /** Current age of primary person. */
  currentAge: number;
  retirementAge: number;
  /** Current total portfolio value. */
  currentPortfolio: number;

  // --- Per-scenario contribution & salary params ---
  /** Total annual employee contributions (current scenario). */
  currentAnnualContributions: number;
  /** Total annual employer match (current scenario). */
  currentEmployerContributions: number;
  /** Combined annual salary (current scenario). */
  currentCombinedSalary: number;
  /** Total annual employee contributions (relocation scenario). */
  relocationAnnualContributions: number;
  /** Total annual employer match (relocation scenario). */
  relocationEmployerContributions: number;
  /** Combined annual salary (relocation scenario). */
  relocationCombinedSalary: number;

  /** Salary growth rate for current scenario. */
  currentSalaryGrowthRate: number;
  /** Salary growth rate for relocation scenario (may differ). */
  relocationSalaryGrowthRate: number;

  /** Withdrawal rate for FI target (e.g. 0.04). */
  withdrawalRate: number;
  inflationRate: number;
  /** Average real return rate (nominal minus inflation). */
  nominalReturnRate: number;
  socialSecurityAnnual: number;
  asOfDate: Date;
};

export type RelocationYearProjection = {
  year: number;
  age: number;
  /** Portfolio balance under current budget. */
  currentBalance: number;
  /** Portfolio balance under relocation budget. */
  relocationBalance: number;
  /** Gap: relocation - current (negative = behind). */
  delta: number;
  /** Annual expenses used in relocation scenario this year. */
  relocationExpenses: number;
  /** Annual contribution used in current scenario this year. */
  currentContribution: number;
  /** Annual contribution used in relocation scenario this year. */
  relocationContribution: number;
  /** Whether this year has an expense adjustment. */
  hasAdjustment: boolean;
  /** Whether this year has a contribution override. */
  hasContributionOverride: boolean;
  /** Net portfolio impact from large purchases this year (negative = withdrawal, positive = sale proceeds). */
  largePurchaseImpact: number;
  /** Total monthly loan + ongoing payments from large purchases active this year. */
  monthlyPaymentFromPurchases: number;
};

export type RelocationResult = {
  // Budget comparison
  currentAnnualExpenses: number;
  relocationAnnualExpenses: number;
  annualExpenseDelta: number;
  monthlyExpenseDelta: number;
  percentExpenseIncrease: number;

  // Savings rate impact
  /** (salary - currentAnnualExpenses) / salary */
  currentSavingsRate: number;
  /** (salary - relocationAnnualExpenses) / salary */
  relocationSavingsRate: number;
  savingsRateDrop: number;

  // FI targets (annual expenses / withdrawal rate)
  currentFiTarget: number;
  relocationFiTarget: number;
  additionalNestEggNeeded: number;

  // FI age (when portfolio crosses FI target during accumulation)
  currentFiAge: number | null;
  relocationFiAge: number | null;
  fiAgeDelay: number | null;

  /** Recommended minimum portfolio before relocating. */
  recommendedPortfolioToRelocate: number;
  /** Earliest age where relocating still reaches relocation FI target by retirement. */
  earliestRelocateAge: number | null;

  /** Total one-time portfolio hit from all large purchases (cash outlays minus sale proceeds). */
  totalLargePurchasePortfolioHit: number;
  /** Steady-state monthly cost added by large purchases (ongoing costs + loan payments for active loans). */
  steadyStateMonthlyFromPurchases: number;

  projectionByYear: RelocationYearProjection[];
  warnings: string[];
};

// --- Monte Carlo Simulation ---

/** Per-year percentile band for fan chart rendering. */
export type MonteCarloPercentileBand = {
  year: number;
  age: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  mean: number;
};

/** Summary statistics for a distribution of outcomes. */
export type DistributionSummary = {
  min: number;
  p5: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  max: number;
  mean: number;
  stdDev: number;
};

/** Input to the Monte Carlo simulation. */
export type MonteCarloInput = {
  /** The base engine input (deterministic scenario). */
  engineInput: ProjectionInput;

  /** Number of simulation trials (default 1000). */
  numTrials: number;
  /** Seed for reproducibility (optional, uses Date.now() if not provided). */
  seed?: number;

  /** Asset class parameters for return modeling. */
  assetClasses: {
    id: number;
    name: string;
    meanReturn: number;
    stdDev: number;
  }[];

  /** Correlation data between asset classes. */
  correlations: {
    classAId: number;
    classBId: number;
    correlation: number;
  }[];

  /** Glide path: allocation by age (sorted by age ascending). */
  glidePath: {
    age: number;
    allocations: Record<number, number>;
  }[];

  /** Optional inflation randomization. */
  inflationRisk?: {
    meanRate: number;
    stdDev: number;
  };

  /** Min return clamp per year (default -0.5 = max 50% loss). */
  returnClampMin?: number;
  /** Max return clamp per year (default 1.0 = max 100% gain). */
  returnClampMax?: number;
};

/** Full result from a Monte Carlo simulation. */
export type MonteCarloResult = {
  /** % of trials where money lasts through projection end. */
  successRate: number;
  /** 50th percentile terminal balance. */
  medianEndBalance: number;
  /** Average terminal balance. */
  meanEndBalance: number;

  /** Percentile bands for fan chart (one entry per projection year). */
  percentileBands: MonteCarloPercentileBand[];

  /** The deterministic projection (current engine output) for comparison. */
  deterministicProjection: ProjectionResult;

  /** Distribution of key outcomes. */
  distributions: {
    terminalBalance: DistributionSummary;
    depletionAge: DistributionSummary | null;
    sustainableWithdrawal: DistributionSummary;
    /** Sustainable withdrawal deflated to today's dollars. */
    sustainableWithdrawalPV: DistributionSummary;
  };

  /** Worst-case analysis. */
  worstCase: {
    p5DepletionAge: number | null;
    p5EndBalance: number;
  };

  /** Metadata. */
  numTrials: number;
  computeTimeMs: number;
  warnings: string[];
};
