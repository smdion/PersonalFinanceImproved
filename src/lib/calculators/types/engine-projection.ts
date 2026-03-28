// Engine projection output types — year rows, phase results, and the full projection result.

import type { AccountCategory } from "@/lib/config/account-types";
import type {
  TaxBuckets,
  AccountBalances,
  IndividualAccountYearBalance,
  IndividualAccountInput,
  RetirementYearOverride,
  FilingStatusType,
} from "./shared";
import type {
  AccumulationDefaults,
  AccumulationOverride,
  AccumulationSlot,
  ContributionSpec,
  DecumulationDefaults,
  DecumulationOverride,
  DecumulationSlot,
  ProfileSwitch,
  ResolvedAccumulationConfig,
  ResolvedDecumulationConfig,
} from "./engine-config";

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
  /** Social Security annual income (kicks in at ssStartAge).
   *  When socialSecurityEntries is provided, this is ignored. */
  socialSecurityAnnual: number;
  /** Age at which Social Security income begins (default 67).
   *  When socialSecurityEntries is provided, this is ignored. */
  ssStartAge: number;
  /** Per-person Social Security entries. Each person can have a different
   *  annual amount and start age. When provided, overrides the scalar
   *  socialSecurityAnnual and ssStartAge fields. */
  socialSecurityEntries?: {
    personId: number;
    personName: string;
    annualAmount: number;
    /** Age of THIS person (not household avg) when SS begins. */
    startAge: number;
    /** Birth year of this person — used to compute their age each projection year. */
    birthYear: number;
  }[];
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
  /** Per-person SS income breakdown (populated when socialSecurityEntries is provided). */
  ssIncomeByPerson?: { personId: number; personName: string; amount: number }[];
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
