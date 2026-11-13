/**
 * Shared types for the projection year-handler functions.
 */
import type { InflationPath } from "../inflation-path";
import type {
  ProjectionInput,
  ProjectionResult,
  EngineYearProjection,
} from "../types/projection-result";
import type { AccountCategory } from "../../../config/account-types";
import type {
  TaxBuckets,
  AccountBalances,
  IndividualAccountInput,
} from "../../accounts/account-balances.types";
import type {
  ContributionSpec,
  ProfileSwitch,
} from "../types/contribution-spec";
import type {
  AccumulationDefaults,
  AccumulationOverride,
} from "../types/accumulation";
import type { DecumulationOverride } from "../types/decumulation";
import type { SpendingCrossYearState } from "../types/spending-strategy";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import type { makeIndKey } from "../individual-accounts/ledger";
import type { RothBasisState } from "@/lib/pure/accounts/roth-basis-tracking";
import type { NonRetirementExclusion } from "@/lib/pure/accounts/eligibility";
import type { BrokerageBasis } from "../brokerage-basis";
import type { YearIncome } from "@/lib/pure/tax/year-income";
import type { computeWithdrawalEligibility } from "@/lib/pure/accounts/eligibility";
import type { resolveDecumulationConfig } from "../override-resolution";
import type {
  growIrmaaBrackets,
  growLtcgBrackets,
  growWithholdingBrackets,
} from "../bracket-growth";
import type { socialSecurityForYear } from "../social-security-income";

// ---------------------------------------------------------------------------
// Local type used by brokerage goals (defined locally in projection.ts)
// ---------------------------------------------------------------------------

export type BrokerageGoal = {
  id: number;
  name: string;
  targetAmount: number;
  targetYear: number;
  priority: number;
};

// ---------------------------------------------------------------------------
// Structured types
// ---------------------------------------------------------------------------

export type ProjectionLoopState = {
  // Balance tracking
  balances: TaxBuckets;
  accountBalance: AccountBalances;
  priorYearEndTradBalance: number;
  /** Per-person prior-year Traditional balance for per-person RMD. */
  priorYearEndTradByPerson: Map<number, number>;

  // Salary/expense tracking
  projectedSalary: number;
  projectedExpenses: number;
  /** The strategy-blind budget line (inflation growth + per-year overrides only); reactive
   *  strategies overwrite `projectedExpenses` with their target, so "vs budget" needs this. */
  budgetOnlyExpenses: number;
  /** This year's amount as the gross portfolio withdrawal (Social Security
   *  on top) — set when the strategy sized it that way and the household's
   *  `ssInAmount` switch is off; null = the amount is spending. */
  portfolioWithdrawal: number | null;
  projectedSalaryByPerson: Map<number, number>;

  // Individual account tracking
  indBalance: Map<string, number>;
  /** Tracked Roth basis per taxFree-bucket account (see
   *  `@/lib/pure/accounts/roth-basis-tracking`). Present only for accounts
   *  where `isTaxFreeBucket(ia.taxType)`; absent for everything else. */
  indBasis: Map<string, RothBasisState>;
  /** Brokerage cost basis per basis-tracking account (brokerage-basis.ts). */
  brokBasis: BrokerageBasis;
  specToAccount: Map<string, string>;
  accountsWithSpecs: Set<string>;

  // Contribution/profile tracking (mutable due to profile switches)
  contributionSpecs: ContributionSpec[] | undefined;
  activeEmployerMatchRateByCategory: Record<AccountCategory, number>;
  activeBaseYearContributions: Record<AccountCategory, number> | undefined;
  activeBaseYearEmployerMatch: Record<AccountCategory, number> | undefined;
  activeEmployerMatchByParentCat:
    Map<AccountCategory, Map<string, number>> | undefined;
  accumulationDefaults: AccumulationDefaults;

  // Spending strategy
  spendingState: SpendingCrossYearState;

  // Tax/IRMAA history
  incomeHistory: YearIncome[];
  /** The no-owner Traditional account warning is said once a projection. */
  rmdNoOwnerWarned: boolean;

  // Phase tracking
  /** True from the first decumulation year so the expense reset fires once (year may never
   *  equal retirementYear when retiring mid-year). */
  decumulationExpensesSet: boolean;
  /** The first decumulation year's stated need in that year's dollars, set
   *  once with the decumulation budget; null without one. The result's
   *  `firstDecumulationYearStatedNeed`. */
  firstDecumulationYearStatedNeed: number | null;

  // Milestone tracking
  firstOverflowYear: number | null;
  firstOverflowAge: number | null;
  firstOverflowAmount: number | null;
  retirementDepletionYear: number | null;
  retirementDepletionAge: number | null;

  // Depletion tracking
  accountDepletions: ProjectionResult["accountDepletions"];
  depletionTracked: Set<string>;

  // Output accumulator
  projectionByYear: EngineYearProjection[];
};

export type ProjectionContext = {
  // Input references
  input: ProjectionInput;

  // Validated rates
  salaryGrowthRate: number;
  /** The plan's rate, for what must not follow a trial's realized path:
   *  forecasts. Everything else reads `inflation`. */
  planInflationRate: number;
  validatedPostRetirementInflation: number;
  inflation: InflationPath;

  // Pre-built maps
  salaryOverrideMap: Map<number, number>;
  perPersonSalaryOverrides: Map<number, Map<number, number>>;
  /** personId → year-0-only bonus adjustment (see ProjectionInput's
   *  currentYearBonusAdjustment docblock). */
  currentYearBonusAdjustment: Map<number, number>;
  budgetOverrideMap: Map<number, number>;
  returnRateMap: Map<number, number>;
  brokerageGoalsByYear: Map<number, BrokerageGoal[]>;
  sortedAccOverrides: AccumulationOverride[];
  sortedDecumulationOverrides: DecumulationOverride[];
  sortedProfileSwitches: ProfileSwitch[];

  // Individual account setup
  hasIndividualAccounts: boolean;
  /** Some part is a held account (`origin` absent): per-owner RMDs, QCDs and
   *  penalty eligibility need one; synthetic parts keep the household's path. */
  holdsAccounts: boolean;
  indAccounts: IndividualAccountInput[];
  indKey: ReturnType<typeof makeIndKey>;
  indParentCat: Map<string, string>;
  hasPerPersonSalary: boolean;
  /** Each person's working years: their job's, ending by their own
   *  retirement (context.ts). Empty = everyone works throughout. */
  workingYearsByPerson: Record<
    number,
    { start: number | null; end: number | null }
  >;

  // Spending strategy config
  activeStrategy: WithdrawalStrategyType;
  activeStrategyParams: Record<string, number | boolean>;

  // Engine config
  firstYearFraction: number;
  rmdStartAge: number | null;
  rmdStartAgeByPerson: Map<number, { startAge: number; birthYear: number }>;
  /** Whose RMD an account with no owner counts toward (rmdOwnerOf): the
   *  household's primary person. */
  primaryPersonId: number | null;
  yearsToProject: number;

  // Constants
  ACCOUNT_CATEGORIES: AccountCategory[];
  OVERFLOW_CATEGORY: AccountCategory;
  TAX_ADVANTAGED: Set<AccountCategory>;
};

export type PreYearSetup = {
  age: number;
  year: number;
  isAccumulation: boolean;
  returnRate: number;
  strategyAction: string | null;
  /** Start-of-year retirement-spendable balance (all accounts less `nonRetirement`); spending
   *  strategies and the Rate-Seeded seed size from it. Equals `totalBalance` in accumulation. */
  retirementBalance: number;
  /** Start-of-year balance of every account, Portfolio included: the tax gross-up's cap. Routing
   *  then excludes Portfolio money and records the unmet part (`nonRetirementShortfall`). */
  totalBalance: number;
  /** This decumulation year's Portfolio-parented balances, computed once in pre-year setup.
   *  Undefined in accumulation and without individual accounts. */
  nonRetirement: NonRetirementExclusion | undefined;
  /** state.projectedSalary plus this year's bonus adjustment (not persisted); use it for this
   *  year's contribution/tax/cashflow math. */
  effectiveSalary: number;
  /** Per-person equivalent of effectiveSalary, only populated when
   *  hasPerPersonSalary is true. */
  effectiveSalaryByPerson: Map<number, number>;
  /** True when this year's effectiveSalary differs from state.projectedSalary
   *  because of a current-year bonus pin — distinct from hasSalaryOverride,
   *  which the UI ties to salary overrides specifically. */
  hasBonusAdjustment: boolean;
  /** This year's contribution specs when someone isn't at work this year
   *  (input.workingYearsByPerson): theirs zeroed, in spec order. Undefined
   *  = state.contributionSpecs as they are. */
  yearSpecs?: ContributionSpec[];
  /** Someone with a job has stopped working (a partial retirement, or a job
   *  over before its holder retires), so pay may not cover the budget. A
   *  job that hasn't started yet doesn't count: nothing changed. */
  gapYear: boolean;
  /** Nobody saves this year: nobody's at work, or the household chose to
   *  stop in gap years. */
  savingStopped: boolean;
};

/** The year's tax tables, each grown to the year (year-tax-tables.ts). */
export type YearTaxTables = {
  grownTaxBrackets: ReturnType<typeof growWithholdingBrackets> | undefined;
  grownStandardDeduction: number | undefined;
  grownLtcgBrackets: ReturnType<typeof growLtcgBrackets>;
  grownIrmaaBracketsForCheck: ReturnType<typeof growIrmaaBrackets>;
  grownIrmaaBracketsForCap: ReturnType<typeof growIrmaaBrackets>;
  fplGrowthFactor: number;
};

/** A decumulation year's facts, settled before its first draw: each stage
 *  from the need on reads them here, by name. */
export type DecumulationYear = {
  year: number;
  age: number;
  setup: PreYearSetup;
  config: ReturnType<typeof resolveDecumulationConfig>;
  eligibility: ReturnType<typeof computeWithdrawalEligibility> | undefined;
  taxRates: ProjectionInput["decumulationDefaults"]["distributionTaxRates"];
  tables: YearTaxTables;
  ssIncome: number;
  personsAge65Plus: number;
  retirementBasisRatio: number | undefined;
  ssIncomeByPerson: ReturnType<
    typeof socialSecurityForYear
  >["ssIncomeByPerson"];
  /** Traditional's share of the retirement balance after the QCD (the row's). */
  estTraditionalPortion: number;
  /** Last year-end's Traditional balance, read before the close resets it. */
  priorYearEndTradBalance: number;
};
