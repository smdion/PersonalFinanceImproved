// Engine projection output types — year rows, phase results, and the full projection result.

import type { GapYearDraw } from "./gap-year-draw";
import type { AccountCategory } from "@/lib/config/account-types";
import type {
  TaxBuckets,
  AccountBalances,
  IndividualAccountYearBalance,
  IndividualAccountInput,
} from "../../accounts/account-balances.types";
import type { RetirementYearOverride } from "./year-overrides";
import type {
  AccumulationDefaults,
  AccumulationOverride,
  ResolvedAccumulationConfig,
} from "./accumulation";
import type { AccumulationSlot, DecumulationSlot } from "./routing";
import type { ContributionSpec, ProfileSwitch } from "./contribution-spec";
import type {
  DecumulationDefaults,
  DecumulationOverride,
  ResolvedDecumulationConfig,
} from "./decumulation";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

// --- Engine Input ---

/**
 * Full engine input: page-level defaults plus per-year overrides (only changed fields), resolved
 * sticky-forward per field each year; accumulation and decumulation project in one pass.
 */
export type ProjectionInput = {
  /** Notes from building this input (shown with the result's warnings). */
  inputWarnings?: string[];
  // --- Defaults (from Projection Assumptions) ---
  accumulationDefaults: AccumulationDefaults;
  decumulationDefaults: DecumulationDefaults;

  /** Spending that ends: a loan paid off (expense-endings.ts). */
  expenseEndings?: ExpenseEnding[];
  // --- Per-year overrides ---
  /**
   * Accumulation overrides, sorted by year. Each entry's fields are
   * sticky-forward (persist until the next override for that field).
   * Used during years where age < retirementAge.
   */
  accumulationOverrides: AccumulationOverride[];

  /**
   * Decumulation overrides, sorted by year. Same sticky-forward semantics.
   * Used from `retirementYear` on.
   */
  decumulationOverrides: DecumulationOverride[];

  // --- Person / salary ---
  /** The primary person's age in the first year (householdTimeline). */
  currentAge: number;
  /** The first year of withdrawals: the last earner's retirement year. */
  retirementYear: number;
  /** Each earner's own retirement year (personId → year). Someone retiring
   *  before `retirementYear` has no pay from then and their contributions
   *  stop, while the accumulation handler runs on for the others. */
  retirementYearByPerson?: Record<number, number>;
  /** Payroll tax from reference data: what a gap year's take-home takes out
   *  of each person's pay. */
  payrollTax?: {
    socialSecurityRate: number;
    medicareRate: number;
    socialSecurityWageBase: number;
  };
  /** The working budget's contribution lines, a year, in today's dollars. */
  budgetContributionLines?: number;
  /** The projection's last year. */
  projectionEndYear: number;
  currentSalary: number;
  salaryGrowthRate: number;
  /** Each person's own raise rate, by person id, for per-person salaries
   *  (`salaryByPerson`); a person missing here grows at `salaryGrowthRate`.
   *  A scenario that sets one household rate leaves this undefined. */
  salaryGrowthRateByPerson?: Record<number, number>;
  salaryCap: number | null;
  salaryOverrides: RetirementYearOverride[];
  /** Per-person starting salaries (personId → annual), summing to currentSalary; lets per-person
   *  salary overrides affect only that person's specs. */
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
  /**
   * Year-0-only salary delta per person (pinned actual bonus vs the formula bonus); applied to
   * that year's `effectiveSalary` only, never compounded into later growth.
   */
  currentYearBonusAdjustment?: Record<number, number>;
  /**
   * Each person's whole years at work (`start` null = working now, `end` null = no end). Outside
   * them pay, contributions and match stop while salary keeps growing. Absent = always working.
   */
  workingYearsByPerson?: Record<
    number,
    { start: number | null; end: number | null }
  >;

  // --- IRS limits ---
  /**
   * Inputs for the IRS-limit caps (contribution-caps.ts): the base year's limit record (grown at
   * limitGrowthRate), people whose Dec 31 ages set catch-ups, and the household's limited accounts.
   */
  irsLimitCaps: {
    /** The household's filing status — married filers share a family HSA
     *  limit and can fund a spousal IRA. Required here even where the
     *  engine's own `filingStatus` is left out. */
    filingStatus: string;
    limits: Record<string, number>;
    people: { id: number; birthYear: number | null }[];
    accounts: {
      personId: number | null;
      accountType: string;
      hsaCoverageType: string | null;
    }[];
  };
  /** How fast IRS limits grow annually (e.g. 0.02 = 2%/year). */
  limitGrowthRate: number;

  // --- Employer match ---
  /** Employer match as rate of salary per category (for salary-linked growth). */
  employerMatchRateByCategory: Record<AccountCategory, number>;
  /** Employer match broken down by category → parentCategory → amount.
   *  Used to distribute match only to individual accounts from the correct parentCategory. */
  employerMatchByParentCat?: Map<AccountCategory, Map<string, number>>;

  // --- Per-account contribution specs (from paycheck/contributions page) ---
  /**
   * Per-account contribution specs; years 1+ then compute per account: percent_of_salary follows
   * salary, fixed ones IRS limit growth; tax-advantaged ones cap at IRS limits, overflow to brokerage.
   */
  contributionSpecs?: ContributionSpec[];

  /**
   * Future-year contribution profile switches (specs, employer match), sorted by year. Profile
   * salary overrides arrive through perPersonSalaryOverrides.
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
  /** Per-account starting balances (401k/IRA split), tracked through both
   *  phases. Built from portfolio_accounts snapshot. */
  startingAccountBalances: AccountBalances;

  /** Starting balances per named account; when given, each is tracked through both phases
   *  (contributions matched by spec name, growth per account). */
  individualAccounts?: IndividualAccountInput[];

  // --- Expenses & return rates ---
  annualExpenses: number;
  /** Expense growth rate during accumulation (pre-retirement). */
  inflationRate: number;
  /** Expense growth rate during decumulation (post-retirement).
   *  Typically higher than pre-retirement due to healthcare costs.
   *  Falls back to inflationRate if not provided. */
  postRetirementInflationRate?: number;
  /** A Simulation trial's yearly inflation shocks, added to both rates
   *  (engine/inflation-path.ts). Absent = the plan's rates every year. */
  inflationShocks?: readonly number[];
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
  /** Stock share of the portfolio (0–1) by age, from the allocation glide
   *  path (lib/pure/simulation/stock-share.ts) — what VPW sizes its percentage by.
   *  Absent: no allocation, the strategy's own stock share applies. */
  stockShareByAge?: Record<number, number>;
  /** Filing status — used for accurate SS taxation and LTCG brackets.
   *  When omitted, falls back to flat 85% SS taxation and flat LTCG rate. */
  filingStatus?: ReturnFilingStatus;
  /** Enable IRMAA awareness — report Medicare surcharge cliffs (65+). */
  enableIrmaaAwareness?: boolean;
  /** IRMAA surcharges are paid on top of the retirement budget (a year's
   *  need rises by the surcharge) rather than sitting inside it. Only the
   *  income-based surcharge: base Part B and D premiums aren't modeled. */
  irmaaOnTopOfBudget?: boolean;
  /** In a gap year (gap-year-draw.ts) nobody saves. */
  gapYearStopSaving?: boolean;
  /** False: a gap year doesn't draw; spending is cut to what's coming in. */
  gapYearDraws?: boolean;
  /** The household's primary person: an account with no owner counts toward
   *  this person's RMD. */
  primaryPersonId?: number;
  /** When true, cap Roth conversions to stay below the next IRMAA cliff (default: true when IRMAA awareness is on). */
  irmaaAwareRothConversions?: boolean;
  /** Enable ACA subsidy awareness (pre-65): report MAGI headroom below the subsidy cliff and warn when a year crosses it; never caps MAGI. */
  enableAcaAwareness?: boolean;
  /** Household size for ACA FPL calculation (default 2). */
  householdSize?: number;
  /** Per-person birth years for age-gated checks (IRMAA at 65+, ACA below 65).
   *  IRMAA applies when ANY person is ≥65; ACA applies when ALL persons are <65.
   *  Falls back to deriving age from `currentAge` if not provided. */
  perPersonBirthYears?: number[];
  /** Annual expenses for decumulation phase. When set, projectedExpenses resets to this value at retirement age. */
  decumulationAnnualExpenses?: number;
  /** Rate-Seeded: seed the first decumulation year's spending from `withdrawalRate × balance`
   *  instead of the budget or a year-1 override; later years run the strategy as usual. */
  rateSeededDecumulationYear1?: boolean;
  asOfDate: Date;
};

// --- Engine Output ---

/** A budget line that stops: its share of each phase's budget, from `year`
 *  on. Zero for a phase whose spending was typed in, not built from lines. */
export type ExpenseEnding = {
  year: number;
  accumulation: number;
  decumulation: number;
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
  /** True in year 0 when a nonzero `currentYearBonusAdjustment` applied. Distinct from
   *  hasSalaryOverride (retirement_salary_overrides / perPersonSalaryOverrides). */
  hasBonusAdjustment: boolean;
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
  /** Set when a paycheck is gone and pay didn't cover the budget: what came
   *  out of the accounts (gap-year-draw.ts). */
  gapDraw?: GapYearDraw;
  /** Nobody saved this year. Set with `gapDraw`. */
  savingStopped?: boolean;
  /** Retirement money at end of year: every account minus the
   *  Portfolio-parented ones (savings outside retirement accounts) — what
   *  retirement answers count (depletion, success, nest egg). */
  retirementBalance: number;
  /** Every account at end of year, Portfolio included, for net-worth views only. In a row
   *  narrowed to one parent (filterYearByParentCategory) it is that view's accounts. */
  allAccountsBalance: number;
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
  /** Projected annual expenses. Reactive strategies overwrite it with their target (use
   *  `budgetOnlyExpenses` for the budget); with `withdrawalSized` it is the gross withdrawal
   *  (use `spending`). */
  projectedExpenses: number;
  /** What the household spends this year: what the withdrawal delivered
   *  after tax and penalty, less RMD money reinvested, plus Social
   *  Security. Every "spending" / "expenses" reader reads this. */
  spending: number;
  /** The strategy sized the gross portfolio withdrawal and Social Security
   *  comes on top (the household's switch off). */
  withdrawalSized: boolean;
  /** The budget trajectory (growth + per-year overrides, never a strategy's adjustment); "vs
   *  Budget" comparisons read this. Equals `projectedExpenses` for Fixed. */
  budgetOnlyExpenses: number;
  hasBudgetOverride: boolean;
  /** Brokerage (Portfolio-category) contributions that continue post-retirement. */
  brokerageContribution: number;
  /** Brokerage ramp amount continuing post-retirement. */
  brokerageRampContribution: number;
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
  /** Tax on the taxable share of Social Security (part of `taxCost`) —
   *  owed whether or not anything is withdrawn, so it's left out of
   *  `effectiveTaxRate` and shown on its own line. */
  ssTaxCost: number;
  /** Bracket-estimated effective tax rate on this year's withdrawals (0–1). */
  effectiveTaxRate: number;
  // --- Diagnostic fields (for debugging withdrawal calculations) ---
  /** Social Security income for this year (0 if not yet started). */
  ssIncome: number;
  /** Per-person SS income breakdown (populated when socialSecurityEntries is provided). */
  ssIncomeByPerson?: { personId: number; personName: string; amount: number }[];
  /** After-tax expense need (projectedExpenses - ssIncome; with
   *  `withdrawalSized`, what the fixed withdrawal delivers after tax). */
  afterTaxNeed: number;
  /** Gross-up multiplier: 1 / (1 - effectiveTaxRate). */
  grossUpFactor: number;
  /** Fraction of portfolio in pre-tax accounts (drives tax rate weighting). */
  estTraditionalPortion: number;
  /** Debug: bracket-filling traditional cap (income cap - taxable SS). */
  bracketTraditionalCap?: number;
  /** This year's standard deduction grown from its vintage (`growAmount`), matching
   *  `bracketTraditionalCap`; read this, not the ungrown `engineSettings.standardDeduction`. */
  standardDeduction?: number;
  /** How the need beyond Traditional's bracket-fill target was sourced, in draw order, at each
   *  tier's cost (`RouteResult.tierBreakdown`). bracket_filling only; else undefined/empty. */
  discretionaryTierBreakdown?: {
    source: "roth" | "brokerage" | "hsa";
    costRate: number;
    amount: number;
    /** Brokerage: `costRate` includes the 3.8% Medicare surtax. */
    includesNiit?: true;
  }[];
  /** The two zero-cost tiers' capacity this year before ordering or drawing, visible even when
   *  untouched (`RankedWithdrawalTiers`). bracket_filling only; undefined otherwise. */
  rothBasisCapacity?: number;
  brokerageZeroLtcgCapacity?: number;
  /** Unmet withdrawal need after routing (target − actual), from all three routing modes;
   *  includes need left unfunded to avoid penalized money. */
  unmetNeed?: number;
  /** The one verdict on whether `unmetNeed` is a material shortfall (`unmetNeed` can carry
   *  rounding residue); UI alerting keys off this (`SHORTFALL_MATERIALITY`). */
  unmetNeedMaterial?: boolean;
  /** The bar `unmetNeedMaterial` uses: $50 or 1% of the year's need,
   *  whichever is greater. Also what counts as "no money left" for the
   *  plan judge (plan-outcome.ts) — one threshold, set here. */
  shortfallMaterialityFloor?: number;
  /** Part of `unmetNeed` due to excluding penalty-exposed money rather than lack of money
   *  (`RouteResult` docblock, withdrawal-routing/types.ts). */
  penaltyAvoidedShortfall?: number;
  /** Part of `unmetNeed` due to excluding Portfolio-parented money (`RouteResult` docblock);
   *  independent of `penaltyAvoidedShortfall`. */
  nonRetirementShortfall?: number;
  /** Early-withdrawal penalty charged this year; nonzero only when penalized money was drawn.
   *  Not in `taxCost` (`ComputeTaxFromSlotsResult`). */
  penaltyCost?: number;
  /** What the withdrawals delivered to spend after tax and penalty
   *  (totalWithdrawal − taxCost − penaltyCost) — compare with
   *  `afterTaxNeed`. */
  deliveredAfterTax?: number;
  /** Retirement money (HSA aside) still locked by early-withdrawal rules and not opted into a
   *  penalized draw. Undefined without per-account tracking. */
  penaltyLockedStillExcluded?: number;
  /** Debug: pre-withdrawal per-account balances (what the router sees). */
  preWithdrawalAcctBal?: AccountBalances;
  /** Retirement money at end of year: every account minus the
   *  Portfolio-parented ones (savings outside retirement accounts) — what
   *  retirement answers count (depletion, success, nest egg). */
  retirementBalance: number;
  /** Every account at end of year, Portfolio included, for net-worth views only. In a row
   *  narrowed to one parent (filterYearByParentCategory) it is that view's accounts. */
  allAccountsBalance: number;
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
  // --- RMD fields ---
  /** Required Minimum Distribution amount for this year (0 if not applicable). */
  rmdAmount: number;
  /** Per-person RMDs: `amount = priorYearEndTradBalance / divisor` (Uniform Lifetime Table for
   *  `age`); `divisor` undefined when `getRmdFactor` has no entry for the age. */
  rmdByPerson?: {
    personId: number;
    personName: string;
    amount: number;
    divisor?: number;
    priorYearEndTradBalance?: number;
    age?: number;
    /** What this person's own accounts couldn't pay of the RMD (never
     *  taken from a spouse's). */
    shortfall?: number;
  }[];
  /** Traditional dollars routing took from the wrong owner's accounts,
   *  moved to fall on the right owner's for their RMD. No change in income.
   *  Absent when nothing moved. */
  rmdReassignedAmount?: number;
  /** Household-level Uniform Lifetime divisor when `rmdByPerson` isn't populated:
   *  `rmdAmount = priorYearEndTradBalance / rmdDivisor`. */
  rmdDivisor?: number;
  /** Prior-year-end Traditional balance the household-level RMD divided.
   *  Pairs with `rmdDivisor`. */
  priorYearEndTradBalance?: number;
  /** True if the RMD forced additional Traditional withdrawals beyond what routing chose. */
  rmdOverrodeRouting: boolean;
  /** Part of `rmdAmount` that couldn't be distributed (25% excise exposure); Portfolio-parented
   *  balances don't count toward capacity (`RmdEnforcementResult.rmdShortfallAmount`). */
  rmdShortfallAmount: number;
  /** RMD-forced money beyond stated need + tax; reinvested or spent per `rmdExcessHandling`
   *  (this is the amount either way). */
  rmdExcessAmount: number;
  /** Part of the household RMD-smoothing target not converted (`rmd-smoothing.ts`); undefined
   *  when smoothing is off or had nothing to convert. */
  rmdSmoothingShortfall?: number;
  /** Total QCD this year (0 unless `qcdMaximize` and an eligible RMD); satisfies that much of
   *  `rmdAmount` untaxed (approximation in `qcd.ts`). */
  qcdAmount: number;
  /** Per-person QCD breakdown, when nonzero. */
  qcdByPerson?: { personId: number; qcdAmount: number }[];
  // --- SS Tax fields ---
  /** Taxable portion of Social Security income (IRS provisional income formula). */
  taxableSS: number;
  // --- LTCG fields ---
  /** Effective LTCG tax rate used for brokerage withdrawals this year (0%, 15%, or 20%). */
  ltcgRate: number;
  // --- Roth Conversion fields ---
  /** Amount converted from Traditional → Roth this year. */
  rothConversionAmount: number;
  /** Tax cost of the Roth conversion (paid from portfolio). */
  rothConversionTaxCost: number;
  /** True when the `irmaaAwareRothConversions` clamp reduced this year's conversion; undefined
   *  otherwise. No numeric field changes. */
  rothConversionIrmaaCapped?: boolean;
  // --- Spending strategy fields ---
  /** Strategy action taken this year (e.g. 'increase', 'decrease', 'skip_inflation', 'floor_applied'). */
  strategyAction: string | null;
  // --- NIIT (Net Investment Income Tax, 3.8% surtax) ---
  /** NIIT amount: 3.8% × min(net investment income, MAGI - threshold). 0 if below threshold. */
  niitAmount: number;
  // --- IRMAA fields ---
  /** Annual IRMAA surcharge, for everyone 65+ together (already multiplied
   *  by that count). 0 if below threshold or awareness disabled. */
  irmaaCost: number;
  /** The part of `irmaaCost` paid on top of the budget
   *  (`irmaaOnTopOfBudget`). Absent when none is. */
  irmaaPaid?: number;
  // --- ACA fields ---
  /** Whether ACA subsidy was preserved this year (MAGI kept below cliff). */
  acaSubsidyPreserved: boolean;
  /** MAGI headroom below ACA cliff ($0 if not applicable). */
  acaMagiHeadroom: number;
  /** Per-year warnings (cap hits, insufficient funds, etc.). */
  warnings: string[];
};

/** A single year in the engine projection — either accumulation or decumulation. */
export type EngineYearProjection =
  EngineAccumulationYear | EngineDecumulationYear;

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
  /** The first year retirement money runs out (retirementBalance < $1;
   *  null if it never does). A balance fact — unmet spending while money
   *  remains is a shortfall, not depletion. */
  retirementDepletionYear: number | null;
  retirementDepletionAge: number | null;
  /** Sustainable annual withdrawal at retirement (portfolio × withdrawal rate).
   *  Not what any strategy actually spends — a reference "4%-rule-style" figure. */
  sustainableWithdrawal: number;
  /** Stated retirement need (decumulationAnnualExpenses) inflated to the first decumulation year,
   *  before any strategy adjusts it; null without a budget. Checks spending against real need. */
  firstDecumulationYearStatedNeed: number | null;
  /** Per-account depletion tracking: first year each account category hits zero. */
  accountDepletions: {
    category: AccountCategory;
    subType?: "traditional" | "roth";
    depletionYear: number;
    depletionAge: number;
  }[];
  warnings: string[];
};
