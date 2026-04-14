/**
 * Shared types for the projection year-handler functions.
 *
 * Extracted from the old single-file `projection-year-handlers.ts` in the
 * v0.5.2 file-split refactor. Pure relocation — no type changes. The
 * `engine-snapshot.test.ts` parity guard runs before and after the split
 * to catch any accidental drift.
 */
import type {
  ProjectionInput,
  ProjectionResult,
  AccountCategory,
  TaxBuckets,
  AccountBalances,
  EngineYearProjection,
  ContributionSpec,
  ProfileSwitch,
  AccumulationDefaults,
  AccumulationOverride,
  DecumulationOverride,
  IndividualAccountInput,
} from "../../types";
import type { SpendingCrossYearState } from "../spending-strategy";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import type { makeIndKey } from "../individual-account-tracking";

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
  acctBal: AccountBalances;
  priorYearEndTradBalance: number;
  /** Per-person prior-year Traditional balance for per-person RMD. */
  priorYearEndTradByPerson: Map<number, number>;

  // Salary/expense tracking
  projectedSalary: number;
  projectedExpenses: number;
  projectedSalaryByPerson: Map<number, number>;

  // Individual account tracking
  indBal: Map<string, number>;
  specToAccount: Map<string, string>;
  accountsWithSpecs: Set<string>;

  // Contribution/profile tracking (mutable due to profile switches)
  contributionSpecs: ContributionSpec[] | undefined;
  activeEmployerMatchRateByCategory: Record<AccountCategory, number>;
  activeBaseYearContributions: Record<AccountCategory, number> | undefined;
  activeBaseYearEmployerMatch: Record<AccountCategory, number> | undefined;
  activeEmployerMatchByParentCat:
    | Map<AccountCategory, Map<string, number>>
    | undefined;
  accumulationDefaults: AccumulationDefaults;

  // Spending strategy
  spendingState: SpendingCrossYearState;

  // Tax/IRMAA history
  magiHistory: number[];

  // Milestone tracking
  firstOverflowYear: number | null;
  firstOverflowAge: number | null;
  firstOverflowAmount: number | null;
  portfolioDepletionYear: number | null;
  portfolioDepletionAge: number | null;

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
  inflationRate: number;
  validatedPostRetirementInflation: number;

  // Pre-built maps
  salaryOverrideMap: Map<number, number>;
  perPersonSalaryOverrides: Map<number, Map<number, number>>;
  budgetOverrideMap: Map<number, number>;
  returnRateMap: Map<number, number>;
  brokerageGoalsByYear: Map<number, BrokerageGoal[]>;
  sortedAccOverrides: AccumulationOverride[];
  sortedDecOverrides: DecumulationOverride[];
  sortedProfileSwitches: ProfileSwitch[];

  // Individual account setup
  hasIndividualAccounts: boolean;
  indAccts: IndividualAccountInput[];
  indKey: ReturnType<typeof makeIndKey>;
  indParentCat: Map<string, string>;
  hasPerPersonSalary: boolean;

  // Spending strategy config
  activeStrategy: WithdrawalStrategyType;
  activeStrategyParams: Record<string, number | boolean>;

  // Engine config
  firstYearFraction: number;
  rmdStartAge: number | null;
  rmdStartAgeByPerson: Map<number, { startAge: number; birthYear: number }>;
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
  totalBalance: number;
};
