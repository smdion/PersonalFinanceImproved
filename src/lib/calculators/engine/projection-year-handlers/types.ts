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
import type { RothBasisState } from "@/lib/pure/roth-basis-tracking";

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
  /** The TRUE, unmutated budget trajectory (inflation/raise growth + manual
   *  per-year overrides only) -- tracked in parallel with `projectedExpenses`
   *  because a reactive strategy (Guyton-Klinger, Forgo Inflation After
   *  Loss, Spending Decline) overwrites `projectedExpenses` in place every
   *  year with its own guardrail-adjusted target, which for a budget-seeded
   *  strategy makes `projectedExpenses` identical to that year's own
   *  `targetWithdrawal` -- collapsing "vs budget" and "vs strategy" into
   *  the same comparison (live-user finding, 2026-08-28: both KPI rings
   *  showing the identical percentage). This field is the strategy-blind
   *  budget line those two comparisons need to actually differ. */
  budgetOnlyExpenses: number;
  projectedSalaryByPerson: Map<number, number>;

  // Individual account tracking
  indBal: Map<string, number>;
  /** Tracked Roth basis per taxFree-bucket account (v0.7.8 follow-up —
   *  see `@/lib/pure/roth-basis-tracking`). Present only for accounts
   *  where `isTaxFreeBucket(ia.taxType)`; absent for everything else. */
  indBasis: Map<string, RothBasisState>;
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
  magiHistory: number[];

  // Phase tracking
  /** Set to true on the first year isAccumulation is false. Prevents the
   *  decumulation expense reset from firing more than once, and handles the
   *  retirementAge===currentAge mid-year case where age never equals
   *  retirementAge on the first decumulation year. */
  decumulationExpensesSet: boolean;

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
  /** personId → year-0-only bonus adjustment (see ProjectionInput's
   *  currentYearBonusAdjustment docblock). */
  currentYearBonusAdjustment: Map<number, number>;
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
  /** state.projectedSalary plus this year's bonus adjustment, if any —
   *  non-persisting (state.projectedSalary itself is never mutated by the
   *  adjustment, so next year's growth compounds from the true baseline).
   *  Use this instead of state.projectedSalary for this year's
   *  contribution/tax/cashflow math. */
  effectiveSalary: number;
  /** Per-person equivalent of effectiveSalary, only populated when
   *  hasPerPersonSalary is true. */
  effectiveSalaryByPerson: Map<number, number>;
  /** True when this year's effectiveSalary differs from state.projectedSalary
   *  because of a current-year bonus pin — distinct from hasSalaryOverride,
   *  which the UI ties to salary overrides specifically. */
  hasBonusAdjustment: boolean;
};
