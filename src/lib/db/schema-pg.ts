// Drizzle schema — all table definitions for ledgr.
// This file is the single source of truth for the data model.
// See Migration Plan Section 4 for design principles and seed data notes.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  date,
  timestamp,
  decimal,
  varchar,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { DEFAULT_WITHDRAWAL_RATE } from "@/lib/constants";

// All enum-like columns are plain `text`, validated at the app layer via Zod
// against const arrays in `src/lib/config/enum-values.ts`.
// Column types are narrowed via `.$type<>()` to preserve TypeScript safety.
// This follows RULES.md principle 9 and enables cross-dialect compatibility.

import type {
  PayPeriod,
  PayWeek,
  TaxTreatment,
  MatchTaxTreatment,
  EmployerMatchType,
  HsaCoverageType,
  AccountOwnership,
  RetirementBehavior,
  ContributionScaling,
  W4FilingStatus,
  BudgetApiService,
  ApiSyncDirection,
  PortfolioTaxType,
  UtilityKind,
  UtilityUnit,
} from "@/lib/config/enum-values";

/** One date-ranged rule directing an extra paycheck to one or more savings goals. */
export type ExtraPaycheckRule = {
  /** "YYYY-MM" — first month this rule applies (inclusive). */
  from: string;
  /** "YYYY-MM" — last month this rule applies (inclusive), or null for open-ended. */
  to: string | null;
  /** How to split the check across goals; pct values must sum to 100. */
  splits: { goalId: number; pct: number }[];
  /**
   * @deprecated Use ExtraPaycheckRoutingData.baseNetPayPerCheck + yearlyGrowth instead.
   * Kept for backward-compat fallback when routing-level base is absent.
   */
  netPaySnapshot?: number;
};

/** A one-time per-month override that takes precedence over the matching rule. */
export type ExtraPaycheckOverride = {
  /** "YYYY-MM" — the specific extra-paycheck month this override applies to. */
  month: string;
  /** Override splits; pct values must sum to 100. */
  splits: { goalId: number; pct: number }[];
};

/** Per-year growth entry for projecting future extra-paycheck net pay. */
export type YearlyGrowthEntry = { type: "pct" | "dollar"; value: number };

/** Top-level shape stored in a Salary Profile entry's `extraPaycheckRouting`
 *  field (see salaryEntrySchema in json-schemas.ts) — moved off
 *  `jobs.extra_paycheck_routing` because it's a comp-layer decision, the
 *  same category of fact as `include401kInBonus`/
 *  `includeBonusInContributions`, not a job identity fact. */
export type ExtraPaycheckRoutingData = {
  rules: ExtraPaycheckRule[];
  overrides?: ExtraPaycheckOverride[];
  /**
   * Net pay per check from the paycheck calculator, snapshotted when rules/growth are saved.
   * Used as the base for projecting future extra-paycheck amounts via yearlyGrowth.
   */
  baseNetPayPerCheck?: number;
  /**
   * The calendar year when baseNetPayPerCheck was recorded. Anchors compounding so that
   * rules applied in future years accumulate the correct number of growth steps.
   */
  baseYear?: number;
  /**
   * Per-year growth rates keyed by year string (e.g. "2027").
   * pct: percentage increase (3 = 3%); dollar: flat dollar increase carried forward.
   * Missing years default to 0% growth. Dollar entries are one-time bumps that
   * compound into the base for subsequent years.
   */
  yearlyGrowth?: Record<string, YearlyGrowthEntry>;
  /**
   * Pay schedule snapshotted alongside baseNetPayPerCheck/baseYear, from the
   * same resolved job entry computeJobNetPayPerCheck already reads. Optional
   * — the materializer prefers this snapshot but falls back to the job's
   * LIVE entry in the globally-active Salary Profile when absent (e.g.
   * routing saved before this field existed). Freezes the schedule at save
   * time so a later job/Salary-Profile correction doesn't retroactively move
   * already-materialized planned-transaction dates — see RULES.md's
   * extraPaycheckRouting section.
   */
  payPeriod?: PayPeriod;
  /** Snapshotted alongside payPeriod above. `null` is a real, complete
   *  value ("no anchor, use start date") — distinct from the field being
   *  entirely absent (pre-snapshot routing, or a schedule that couldn't be
   *  resolved at save time). */
  anchorPayDate?: string | null;
  /**
   * Whether `rules` currently materialize into savings_planned_transactions
   * at all. Absent/true = today's behavior (route to savings goals, per
   * rules/overrides below). false = "Budget" mode — the extra paycheck
   * isn't diverted anywhere; it stays as regular income, same as a job with
   * no routing configured. Distinct from clearing `rules` so a user can
   * pause routing without losing a configured schedule (see
   * extra-paycheck-rules-editor.tsx's Savings/Budget toggle).
   */
  enabled?: boolean;
};

// ============================================================================
// TABLE OF CONTENTS — sections below are in this order:
//
//   1.  People & Jobs .............. people, jobs
//   2.  Contributions & Paycheck ... contributionAccounts, contributionLimits,
//                                    paycheckDeductions
//   3.  Budget ..................... budgetProfiles, budgetItems
//   4.  Savings (sinking funds) .... savingsGoals, savingsMonthly,
//                                    savingsPlannedTransactions,
//                                    savingsAllocationOverrides,
//                                    savingsGoalProfileAllocations
//   5.  Brokerage goals ............ brokerageGoals, brokeragePlannedTransactions
//   6.  Self loans ................. selfLoans
//   7.  Portfolio performance ...... performanceAccounts, portfolioSnapshots,
//                                    portfolioAccounts, annualPerformance,
//                                    accountPerformance, accountHoldings
//   8.  Net worth (annual) ......... netWorthAnnual, homeImprovementItems,
//                                    otherAssetItems, historicalNotes
//   9.  Mortgages .................. mortgageLoans, mortgageWhatIfScenarios,
//                                    mortgageExtraPayments, propertyTaxes,
//                                    utilityService, utilityReading
//  10.  Retirement settings ........ retirementSettings, retirementSalaryOverrides,
//                                    retirementBudgetOverrides, projectionOverrides,
//                                    retirementScenarios
//  11.  Return rates & tax tables .. returnRateTable, taxBrackets, ltcgBrackets,
//                                    irmaaBrackets
//  12.  API sync .................. apiConnections, budgetApiCache,
//                                    simplefinBalanceSnapshots, simplefinAccounts
//  13.  App config / admin ......... appSettings, localAdmins
//  14.  Scenarios (relocation) ..... relocationScenarios, scenarios
//  15.  Monte Carlo ................ assetClassParams, assetClassCorrelations,
//                                    glidePathAllocations, mcPresets,
//                                    mcPresetGlidePaths, mcPresetReturnOverrides,
//                                    mcUserPresets
//  16.  Contribution profiles ...... contributionProfiles, salaryProfiles
//  17.  State versions (backup) .... stateVersions, stateVersionTables, changeLog
//
// NOTE: this file is the source of truth. `schema-sqlite.ts` is auto-generated
// via `npx tsx scripts/gen-sqlite-schema.ts` (mechanical regex transform —
// splitting this file across multiple files would require rewriting that
// codegen to follow TS imports). Keep sections in the order above.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// 1. People & Jobs
// ────────────────────────────────────────────────────────────────────────────

export const people = pgTable("people", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  dateOfBirth: date("date_of_birth").notNull(),
  isPrimaryUser: boolean("is_primary_user").notNull().default(false),
});

export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    employerName: text("employer_name").notNull(),
    title: text("title"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    /** A permanent, auto-provisioned peg for Salary Profiles to pin what-if
     *  scenarios against (e.g. "moving to Chicago in 5 years") — never a
     *  real job. Always has endDate: null (it never "ends") but must be
     *  excluded everywhere "active job" means "this person's real job" —
     *  see findActiveJob/filterActiveJobs in lib/pure/profiles.ts, the
     *  single source of truth for that exclusion. */
    isSpeculative: boolean("is_speculative").notNull().default(false),
  },
  (table) => [
    index("jobs_person_id_idx").on(table.personId),
    index("jobs_is_speculative_idx").on(table.isSpeculative),
    // Exactly one speculative job per person — a DB-enforced invariant, not
    // just an app convention.
    uniqueIndex("jobs_one_speculative_per_person_idx")
      .on(table.personId)
      .where(sql`${table.isSpeculative} = true`),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// 2. Contributions & Paycheck
// ────────────────────────────────────────────────────────────────────────────

export const contributionAccounts = pgTable(
  "contribution_accounts",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    personId: integer("person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    accountType: text("account_type").notNull(),
    subType: text("sub_type"),
    label: text("label"),
    parentCategory: text("parent_category").notNull().default("Retirement"),
    taxTreatment: text("tax_treatment").$type<TaxTreatment>().notNull(),
    // contributionMethod/contributionValue deliberately do NOT live here —
    // an account is purely structural (what it IS); the actual contribution
    // amount/method is ALWAYS a Contribution Profile's active-field entry
    // (contribution_profiles.contribution_active_fields), never a fallback
    // column on the account row. See applyContribActiveFields — there is no
    // base-value fallback, an account with no active entry has no value.
    employerMatchType: text("employer_match_type")
      .$type<EmployerMatchType>()
      .notNull(),
    employerMatchValue: decimal("employer_match_value", {
      precision: 14,
      scale: 2,
    }),
    employerMaxMatchPct: decimal("employer_max_match_pct", {
      precision: 8,
      scale: 6,
    }),
    employerMatchTaxTreatment: text("employer_match_tax_treatment")
      .$type<MatchTaxTreatment>()
      .notNull()
      .default("pre_tax"),
    hsaCoverageType: text("hsa_coverage_type").$type<HsaCoverageType>(),
    autoMaximize: boolean("auto_maximize").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ownership: text("ownership")
      .$type<AccountOwnership>()
      .notNull()
      .default("individual"),
    performanceAccountId: integer("performance_account_id").references(
      () => performanceAccounts.id,
      { onDelete: "set null" },
    ),
    targetAnnual: decimal("target_annual", { precision: 14, scale: 2 }),
    allocationPriority: integer("allocation_priority").notNull().default(0),
    notes: text("notes"),
    isPayrollDeducted: boolean("is_payroll_deducted"),
    priorYearContribAmount: decimal("prior_year_contrib_amount", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    priorYearContribYear: integer("prior_year_contrib_year"),
  },
  (table) => [
    index("contribution_accounts_job_id_idx").on(table.jobId),
    index("contribution_accounts_person_id_idx").on(table.personId),
    index("contribution_accounts_perf_acct_idx").on(table.performanceAccountId),
    index("contribution_accounts_acct_type_idx").on(table.accountType),
    index("contribution_accounts_parent_cat_idx").on(table.parentCategory),
    index("contribution_accounts_is_active_idx").on(table.isActive),
    check(
      "contribution_accounts_parent_cat_check",
      sql`parent_category IN ('Retirement', 'Portfolio')`,
    ),
    // At most one active row per (job, accountType, parentCategory) may
    // carry real employer match config. computeGroupedEmployerMatch
    // (server/helpers/contribution.ts) combines a physical account's
    // Roth/Traditional splits before applying the match cap once, and
    // requires exactly one "winning" row's config for that group — two
    // independently-configured siblings is an ambiguous state the app
    // throws on rather than silently guessing at. These two indexes (job-
    // linked and jobless-fallback-to-person, matching every caller's own
    // resolution convention) stop that state from being written at all.
    uniqueIndex("contribution_accounts_job_match_unq")
      .on(table.jobId, table.accountType, table.parentCategory)
      .where(
        sql`${table.employerMatchType} <> 'none' AND ${table.jobId} IS NOT NULL AND ${table.isActive} = true`,
      ),
    uniqueIndex("contribution_accounts_person_match_unq")
      .on(table.personId, table.accountType, table.parentCategory)
      .where(
        sql`${table.employerMatchType} <> 'none' AND ${table.jobId} IS NULL AND ${table.isActive} = true`,
      ),
  ],
);

export const contributionLimits = pgTable(
  "contribution_limits",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    limitType: text("limit_type").notNull(),
    value: decimal("value", { precision: 12, scale: 6 }).notNull(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("contribution_limits_year_type_idx").on(
      table.taxYear,
      table.limitType,
    ),
  ],
);

export const paycheckDeductions = pgTable(
  "paycheck_deductions",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    deductionName: text("deduction_name").notNull(),
    isPretax: boolean("is_pretax").notNull(),
    ficaExempt: boolean("fica_exempt").notNull().default(false),
  },
  (table) => [index("paycheck_deductions_job_id_idx").on(table.jobId)],
);

// ────────────────────────────────────────────────────────────────────────────
// 3. Budget
// ────────────────────────────────────────────────────────────────────────────

export const budgetProfiles = pgTable(
  "budget_profiles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description"),
    columnLabels: jsonb("column_labels").$type<string[]>().notNull(),
    columnMonths: jsonb("column_months").$type<number[]>(),
    columnContributionProfileIds: jsonb(
      "column_contribution_profile_ids",
    ).$type<(number | null)[]>(),
    /** Per-column Salary Profile pin — parallel to
     *  columnContributionProfileIds, resolved by resolveSalaryProfileId. */
    columnSalaryProfileIds: jsonb("column_salary_profile_ids").$type<
      (number | null)[]
    >(),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("budget_profiles_is_active_idx").on(table.isActive)],
);

export const budgetItems = pgTable(
  "budget_items",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => budgetProfiles.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    amounts: jsonb("amounts").$type<number[]>().notNull(),
    apiCategoryName: text("api_category_name"),
    apiCategoryId: text("api_category_id"),
    apiLastSyncedAt: timestamp("api_last_synced_at", { withTimezone: true }),
    apiSyncDirection: text("api_sync_direction")
      .$type<ApiSyncDirection>()
      .default("pull"),
    contributionAccountId: integer("contribution_account_id").references(
      () => contributionAccounts.id,
      { onDelete: "set null" },
    ),
    isEssential: boolean("is_essential").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("budget_items_profile_id_idx").on(table.profileId),
    index("budget_items_contribution_account_id_idx").on(
      table.contributionAccountId,
    ),
    uniqueIndex("budget_items_profile_cat_sub_idx").on(
      table.profileId,
      table.category,
      table.subcategory,
    ),
  ],
);

// One row per (budget item, service) — replaces the old single-slot
// apiCategoryId/apiCategoryName/apiLastSyncedAt/apiSyncDirection columns on
// budgetItems, which could only hold ONE service's link at a time and
// silently clobbered it when a household linked the same item to a second
// service (YNAB + Actual both connected). Those columns stay on budgetItems,
// dead-but-present, through v0.7.x; cleanup deferred to a future v0.8.0
// squash (see retirement_settings.person_id's precedent).
export const budgetItemCategoryLinks = pgTable(
  "budget_item_category_links",
  {
    id: serial("id").primaryKey(),
    budgetItemId: integer("budget_item_id")
      .notNull()
      .references(() => budgetItems.id, { onDelete: "cascade" }),
    service: text("service").notNull().$type<BudgetApiService>(),
    categoryId: text("category_id").notNull(),
    categoryName: text("category_name"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    syncDirection: text("sync_direction").$type<ApiSyncDirection>(),
  },
  (table) => [
    index("budget_item_category_links_budget_item_id_idx").on(
      table.budgetItemId,
    ),
    uniqueIndex("budget_item_category_links_item_service_idx").on(
      table.budgetItemId,
      table.service,
    ),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// 4. Savings (sinking funds)
// ────────────────────────────────────────────────────────────────────────────

export const savingsGoals = pgTable(
  "savings_goals",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    parentGoalId: integer("parent_goal_id"),
    // Self-referential FK enforced via migration 0001_add_parent_goal_fk.sql
    // (ALTER TABLE ADD CONSTRAINT) — Drizzle cannot self-reference inline.
    targetAmount: decimal("target_amount", { precision: 14, scale: 2 }),
    targetMonths: integer("target_months"),
    targetDate: date("target_date"),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    isEmergencyFund: boolean("is_emergency_fund").notNull().default(false),
    apiCategoryId: text("api_category_id"),
    apiCategoryName: text("api_category_name"),
    isApiSyncEnabled: boolean("is_api_sync_enabled").notNull().default(false),
    reimbursementApiCategoryId: text("reimbursement_api_category_id"),
    targetMode: text("target_mode").notNull().default("fixed"), // 'fixed' | 'ongoing' | 'bucket' — validated by Zod (app-layer, no DB constraint)
  },
  (table) => [index("savings_goals_is_active_idx").on(table.isActive)],
);

// One row per (savings goal, service, role) — replaces the old single-slot
// apiCategoryId/apiCategoryName/isApiSyncEnabled/reimbursementApiCategoryId
// columns on savingsGoals, which could only hold ONE service's link (plus
// one reimbursement link) at a time. See budgetItemCategoryLinks above for
// the same fix applied to budget items; those raw columns stay dead-but-
// present through v0.7.x, cleanup deferred to a future v0.8.0 squash.
export const savingsGoalCategoryLinks = pgTable(
  "savings_goal_category_links",
  {
    id: serial("id").primaryKey(),
    savingsGoalId: integer("savings_goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    service: text("service").notNull().$type<BudgetApiService>(),
    role: text("role").notNull().default("primary"), // 'primary' | 'reimbursement'
    categoryId: text("category_id").notNull(),
    categoryName: text("category_name"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (table) => [
    index("savings_goal_category_links_savings_goal_id_idx").on(
      table.savingsGoalId,
    ),
    uniqueIndex("savings_goal_category_links_goal_service_role_idx").on(
      table.savingsGoalId,
      table.service,
      table.role,
    ),
  ],
);

export const savingsMonthly = pgTable(
  "savings_monthly",
  {
    id: serial("id").primaryKey(),
    goalId: integer("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    monthDate: date("month_date").notNull(),
    balance: decimal("balance", { precision: 14, scale: 2 }).notNull(),
    depositOrWithdrawal: decimal("deposit_or_withdrawal", {
      precision: 14,
      scale: 2,
    }),
    notes: text("notes"),
  },
  (table) => [
    index("savings_monthly_goal_id_idx").on(table.goalId),
    uniqueIndex("savings_monthly_goal_month_idx").on(
      table.goalId,
      table.monthDate,
    ),
  ],
);

export const savingsPlannedTransactions = pgTable(
  "savings_planned_transactions",
  {
    id: serial("id").primaryKey(),
    goalId: integer("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    transactionDate: date("transaction_date").notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(), // positive = deposit, negative = withdrawal
    description: text("description").notNull(),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurrenceMonths: integer("recurrence_months"), // if recurring, repeat every N months
    transferPairId: text("transfer_pair_id"), // non-null + shared between two rows = a transfer pair
    source: text("source").notNull().default("manual"), // 'manual' | 'rule'
  },
  (table) => [
    index("savings_planned_tx_goal_id_idx").on(table.goalId),
    index("savings_planned_tx_source_idx").on(table.source),
  ],
);

// Settlement is per-occurrence rather than a column on the row above, because
// a single recurring row (isRecurring) represents many future occurrences —
// a row-level "settled" flag would incorrectly hide every future occurrence
// once one instance was confirmed. Non-recurring rows just have exactly one
// possible occurrence (their own transactionDate's month).
export const savingsPlannedTxSettlements = pgTable(
  "savings_planned_tx_settlements",
  {
    id: serial("id").primaryKey(),
    plannedTxId: integer("planned_tx_id")
      .notNull()
      .references(() => savingsPlannedTransactions.id, {
        onDelete: "cascade",
      }),
    occurrenceMonth: date("occurrence_month").notNull(), // always the 1st of the settled occurrence's month
    settledAt: timestamp("settled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("savings_planned_tx_settlements_occurrence_idx").on(
      table.plannedTxId,
      table.occurrenceMonth,
    ),
  ],
);

// Per-month allocation overrides for sinking fund projections.
// When set, overrides the default monthly contribution for a goal in that month.
export const savingsAllocationOverrides = pgTable(
  "savings_allocation_overrides",
  {
    id: serial("id").primaryKey(),
    goalId: integer("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    monthDate: date("month_date").notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    source: text("source").notNull().default("manual"),
  },
  (table) => [
    uniqueIndex("savings_alloc_override_goal_month_idx").on(
      table.goalId,
      table.monthDate,
    ),
  ],
);

// Materialized extra-paycheck amounts for jobs whose routing is in Budget
// mode (the complement of the Savings-mode materializer, which writes to
// savings_planned_transactions instead — see extra-paycheck-materializer.ts
// vs. budget-income-materializer.ts). One row per (job, month); no split/goal
// fan-out, since Budget mode has no split concept.
export const budgetIncomeAdjustments = pgTable(
  "budget_income_adjustments",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    monthDate: date("month_date").notNull(), // "YYYY-MM-01"
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    source: text("source").notNull().default("rule"),
  },
  (table) => [
    uniqueIndex("budget_income_adjustments_job_month_idx").on(
      table.jobId,
      table.monthDate,
    ),
  ],
);

// Per-(goal, budget profile) funding — how much a goal is funded, and how
// (percent of leftover vs. flat dollar), is entirely owned per profile.
// Every active (goal, profile) pair has an explicit row; there is no shared
// default a profile falls back to — each budget profile is its own funding
// scenario. Row-per-pair is guaranteed by seeding at goal/profile creation
// time (both start every new pairing at $0/no-percent) and backfilled by
// migration 0006 for pairs that predate this table's mandatory-row model.
// (Goal *identity* — name, target amount/date, priority, etc. — stays on
// savingsGoals and IS shared across profiles; only funding is per-profile.)
export const savingsGoalProfileAllocations = pgTable(
  "savings_goal_profile_allocations",
  {
    id: serial("id").primaryKey(),
    goalId: integer("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    budgetProfileId: integer("budget_profile_id")
      .notNull()
      .references(() => budgetProfiles.id, { onDelete: "cascade" }),
    allocationPercent: decimal("allocation_percent", {
      precision: 6,
      scale: 3,
    }),
    monthlyContribution: decimal("monthly_contribution", {
      precision: 14,
      scale: 2,
    }).notNull(),
  },
  (table) => [
    uniqueIndex("savings_goal_profile_alloc_goal_profile_idx").on(
      table.goalId,
      table.budgetProfileId,
    ),
    index("savings_goal_profile_alloc_profile_idx").on(table.budgetProfileId),
  ],
);

// Brokerage (after-tax) long-term goals — planned withdrawals at a target year.
// Unlike sinking funds (cash), these are invested and subject to capital gains tax.
// ────────────────────────────────────────────────────────────────────────────
// 5. Brokerage goals
// ────────────────────────────────────────────────────────────────────────────

export const brokerageGoals = pgTable(
  "brokerage_goals",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    targetAmount: decimal("target_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    targetYear: integer("target_year").notNull(),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("brokerage_goals_is_active_idx").on(table.isActive)],
);

export const brokeragePlannedTransactions = pgTable(
  "brokerage_planned_transactions",
  {
    id: serial("id").primaryKey(),
    goalId: integer("goal_id")
      .notNull()
      .references(() => brokerageGoals.id, { onDelete: "cascade" }),
    transactionDate: date("transaction_date").notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(), // positive = deposit, negative = withdrawal
    description: text("description").notNull(),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurrenceMonths: integer("recurrence_months"), // if recurring, repeat every N months
  },
  (table) => [index("brokerage_planned_tx_goal_id_idx").on(table.goalId)],
);

// ────────────────────────────────────────────────────────────────────────────
// 6. Self loans
// ────────────────────────────────────────────────────────────────────────────

export const selfLoans = pgTable(
  "self_loans",
  {
    id: serial("id").primaryKey(),
    fromGoalId: integer("from_goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "restrict" }),
    toGoalId: integer("to_goal_id").references(() => savingsGoals.id, {
      onDelete: "restrict",
    }),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    loanDate: date("loan_date").notNull(),
    repaidAmount: decimal("repaid_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    repaidDate: date("repaid_date"),
  },
  (table) => [
    index("self_loans_from_goal_id_idx").on(table.fromGoalId),
    index("self_loans_to_goal_id_idx").on(table.toGoalId),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// 7. Portfolio performance
// ────────────────────────────────────────────────────────────────────────────

export const performanceAccounts = pgTable(
  "performance_accounts",
  {
    id: serial("id").primaryKey(),
    institution: text("institution").notNull(),
    accountType: text("account_type").notNull(),
    subType: text("sub_type"),
    label: text("label"),
    accountLabel: text("account_label").notNull(),
    displayName: text("display_name"),
    ownerPersonId: integer("owner_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    ownershipType: text("ownership_type").$type<AccountOwnership>().notNull(),
    retirementBehavior: text("retirement_behavior")
      .$type<RetirementBehavior>()
      .notNull()
      .default("stops_at_owner_retirement"),
    contributionScaling: text("contribution_scaling")
      .$type<ContributionScaling>()
      .notNull()
      .default("scales_with_salary"),
    costBasis: decimal("cost_basis", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    /** Date the account owner separated from the employer funding this plan
     *  (401k/403b only) — durable, user-set source of truth for Rule of 55
     *  eligibility (Tax Buckets tool). Null = not separated yet / not
     *  applicable / not entered; the UI derives a default suggestion from
     *  linked jobs but never writes it here automatically. */
    separationDate: date("separation_date"),
    /** Household is fine paying the 10%/20% early-withdrawal penalty on
     *  THIS account when the projection needs to draw from it. Default
     *  false = today's behavior (this account participates in the
     *  household-wide hard exclusion like every other account, never
     *  touched while penalty-free money exists anywhere). True makes this
     *  account's penalty-exposed balance normally withdrawable again —
     *  ordinary routing order (waterfall/bracket-filling) decides WHEN it's
     *  drawn, same as any other reachable dollar. This is NOT a strict
     *  "only as a true last resort, after every other account is
     *  exhausted" guarantee — that would require reordering withdrawal
     *  routing across account categories, a larger change tracked
     *  separately (FEATURE-ROADMAP.md R41 follow-up). One-way opt-in per
     *  account, set by the user — never inferred. See R41. */
    allowPenalizedWithdrawals: boolean("allow_penalized_withdrawals")
      .notNull()
      .default(false),
    parentCategory: text("parent_category").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("performance_accounts_inst_type_idx").on(
      table.institution,
      table.accountType,
      table.subType,
      table.label,
      table.ownerPersonId,
    ),
    index("idx_perf_accounts_inst_label").on(
      table.institution,
      table.accountLabel,
    ),
    index("performance_accounts_owner_id_idx").on(table.ownerPersonId),
    index("performance_accounts_category_idx").on(table.parentCategory),
    index("performance_accounts_is_active_idx").on(table.isActive),
    check(
      "performance_accounts_parent_cat_check",
      sql`parent_category IN ('Retirement', 'Portfolio')`,
    ),
  ],
);

/** Manually-tracked basis for the Tax Buckets analysis tool — how much of a
 *  Roth (taxFree) balance is contribution/conversion basis (accessible
 *  penalty-free under IRS ordering rules, for a Roth IRA) vs. growth. Keyed
 *  by (performanceAccountId, ownerPersonId), not a single column on
 *  performanceAccounts, because one account can carry two people's balances
 *  (e.g. a jointly-labeled Roth IRA with separate per-owner amounts).
 *  Named `account_basis` (not `roth_basis`) since it's the intended future
 *  home for other basis kinds (e.g. brokerage cost basis) — currently holds
 *  Roth fields only; brokerage cost basis still lives as a single live
 *  column on performanceAccounts (see tracksCostBasis()), unmigrated. */
/** Year-scoped to mirror accountPerformance/annualPerformance's
 *  live-then-finalized lifecycle: one row per (account, owner, year),
 *  mutable while current, locked by finalizeRothBasisForYear() when
 *  performance.finalizeYear runs. */
export const accountBasis = pgTable(
  "account_basis",
  {
    id: serial("id").primaryKey(),
    performanceAccountId: integer("performance_account_id")
      .notNull()
      .references(() => performanceAccounts.id, { onDelete: "cascade" }),
    ownerPersonId: integer("owner_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    year: integer("year").notNull(),
    /** Contributions — always penalty-free and tax-free, no seasoning clock. */
    contributionBasis: decimal("contribution_basis", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    /** Roth conversions — always tax-free, but penalty-free only once
     *  seasoned (see latestConversionYear). */
    conversionBasis: decimal("conversion_basis", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    /** Most recent tax year a conversion was made, if conversionBasis > 0.
     *  Gating the whole conversionBasis figure on the LATEST (not earliest)
     *  tracked conversion year is deliberately conservative: this is a
     *  pooled total across potentially several years of conversions, so
     *  using the latest year only ever understates penalty-free access,
     *  never overstates it. Null if conversionBasis = 0. */
    latestConversionYear: integer("latest_conversion_year"),
    isFinalized: boolean("is_finalized").notNull().default(false),
    /** True for a row auto-seeded by finalizeRothBasisForYear (carried
     *  forward from the prior year, not yet reviewed) vs. one the user
     *  actually entered/confirmed. Basis normally grows each year, so an
     *  unreviewed seeded row left as-is would silently understate
     *  accessible funds — cleared the moment updateRothBasis touches it. */
    isSeeded: boolean("is_seeded").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("account_basis_account_owner_year_idx").on(
      table.performanceAccountId,
      table.ownerPersonId,
      table.year,
    ),
    index("account_basis_owner_person_id_idx").on(table.ownerPersonId),
    index("account_basis_year_idx").on(table.year),
  ],
);

export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: serial("id").primaryKey(),
    snapshotDate: date("snapshot_date").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
  },
  (table) => [index("portfolio_snapshots_date_idx").on(table.snapshotDate)],
);

export const portfolioAccounts = pgTable(
  "portfolio_accounts",
  {
    id: serial("id").primaryKey(),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => portfolioSnapshots.id, { onDelete: "cascade" }),
    institution: text("institution").notNull(),
    taxType: text("tax_type").$type<PortfolioTaxType>().notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    accountType: text("account_type").notNull(),
    subType: text("sub_type"),
    label: text("label"),
    parentCategory: text("parent_category").notNull().default("Retirement"),
    ownerPersonId: integer("owner_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    performanceAccountId: integer("performance_account_id").references(
      () => performanceAccounts.id,
      { onDelete: "set null" },
    ),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    index("portfolio_accounts_snapshot_id_idx").on(table.snapshotId),
    index("portfolio_accounts_owner_id_idx").on(table.ownerPersonId),
    index("portfolio_accounts_perf_acct_idx").on(table.performanceAccountId),
    index("portfolio_accounts_acct_type_idx").on(table.accountType),
    index("portfolio_accounts_parent_cat_idx").on(table.parentCategory),
    index("portfolio_accounts_is_active_idx").on(table.isActive),
    check(
      "portfolio_accounts_parent_cat_check",
      sql`parent_category IN ('Retirement', 'Portfolio')`,
    ),
  ],
);

export const annualPerformance = pgTable(
  "annual_performance",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    category: text("category").notNull(),
    beginningBalance: decimal("beginning_balance", {
      precision: 14,
      scale: 2,
    }).notNull(),
    totalContributions: decimal("total_contributions", {
      precision: 14,
      scale: 2,
    }).notNull(),
    yearlyGainLoss: decimal("yearly_gain_loss", {
      precision: 14,
      scale: 2,
    }).notNull(),
    endingBalance: decimal("ending_balance", {
      precision: 14,
      scale: 2,
    }).notNull(),
    annualReturnPct: decimal("annual_return_pct", { precision: 8, scale: 6 }),
    employerContributions: decimal("employer_contributions", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    distributions: decimal("distributions", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    fees: decimal("fees", { precision: 14, scale: 2 }).notNull().default("0"),
    rollovers: decimal("rollovers", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    lifetimeGains: decimal("lifetime_gains", {
      precision: 14,
      scale: 2,
    }).notNull(),
    lifetimeContributions: decimal("lifetime_contributions", {
      precision: 14,
      scale: 2,
    }).notNull(),
    lifetimeMatch: decimal("lifetime_match", {
      precision: 14,
      scale: 2,
    }).notNull(),
    isCurrentYear: boolean("is_current_year").notNull().default(false),
    isFinalized: boolean("is_finalized").notNull().default(false),
    /** When true, this row's lifetime_* fields are considered authoritative
     *  and must not be edited via routers. Set on finalization. App-layer
     *  enforcement guards against silent drift when account_performance
     *  rows on a finalized year are edited (per RULES.md § Data Model
     *  Principles point 4 cascade rule). The router-level guard in
     *  performance.ts:updateAnnual is the real protection — these fields
     *  intentionally have NO CHECK constraints because lifetime_gains
     *  can legitimately be negative (cumulative losses across years). */
    isImmutable: boolean("is_immutable").notNull().default(false),
  },
  (table) => [
    uniqueIndex("annual_performance_year_cat_idx").on(
      table.year,
      table.category,
    ),
    check(
      "annual_perf_finalized_not_current",
      sql`NOT (${table.isFinalized} AND ${table.isCurrentYear})`,
    ),
  ],
);

export const accountPerformance = pgTable(
  "account_performance",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    institution: text("institution").notNull(),
    accountLabel: text("account_label").notNull(),
    ownerPersonId: integer("owner_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    beginningBalance: decimal("beginning_balance", {
      precision: 14,
      scale: 2,
    }).notNull(),
    totalContributions: decimal("total_contributions", {
      precision: 14,
      scale: 2,
    }).notNull(),
    yearlyGainLoss: decimal("yearly_gain_loss", {
      precision: 14,
      scale: 2,
    }).notNull(),
    endingBalance: decimal("ending_balance", {
      precision: 14,
      scale: 2,
    }).notNull(),
    annualReturnPct: decimal("annual_return_pct", { precision: 8, scale: 6 }),
    employerContributions: decimal("employer_contributions", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    fees: decimal("fees", { precision: 14, scale: 2 }).notNull().default("0"),
    distributions: decimal("distributions", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    rollovers: decimal("rollovers", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    parentCategory: text("parent_category").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    isFinalized: boolean("is_finalized").notNull().default(false),
    performanceAccountId: integer("performance_account_id")
      .notNull()
      .references(() => performanceAccounts.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("account_perf_year_inst_label_owner_idx").on(
      table.year,
      table.institution,
      table.accountLabel,
      table.ownerPersonId,
    ),
    index("account_performance_owner_id_idx").on(table.ownerPersonId),
    index("account_performance_perf_acct_idx").on(table.performanceAccountId),
    index("account_performance_is_active_idx").on(table.isActive),
  ],
);

export const pendingRollovers = pgTable(
  "pending_rollovers",
  {
    id: serial("id").primaryKey(),
    /** The account_performance row the rollover originates from (ESPP side). */
    sourceAccountPerformanceId: integer("source_account_performance_id")
      .notNull()
      .references(() => accountPerformance.id, { onDelete: "restrict" }),
    /** The master performance_accounts record the money is going to. Year-row may not exist yet at record time. */
    destinationPerformanceAccountId: integer(
      "destination_performance_account_id",
    )
      .notNull()
      .references(() => performanceAccounts.id, { onDelete: "restrict" }),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    saleDate: date("sale_date").notNull(),
    /** Year the rollover originates from — determines which source account_performance row is debited. */
    saleYear: integer("sale_year").notNull(),
    /** Year the rollover applies to on the destination side (defaults to saleYear; may differ for Dec→Jan wires). */
    applyYear: integer("apply_year").notNull(),
    notes: text("notes"),
    /** Set when the user confirms the wire has landed in the destination account. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("pending_rollovers_source_idx").on(table.sourceAccountPerformanceId),
    index("pending_rollovers_dest_idx").on(
      table.destinationPerformanceAccountId,
    ),
    index("pending_rollovers_sale_year_idx").on(table.saleYear),
    index("pending_rollovers_confirmed_idx").on(table.confirmedAt),
  ],
);

export const accountHoldings = pgTable(
  "account_holdings",
  {
    id: serial("id").primaryKey(),

    // Which account and which snapshot this holding belongs to.
    // Holdings are immutable once the snapshot is taken — updating
    // holdings creates new rows under the new snapshot, not in-place edits.
    performanceAccountId: integer("performance_account_id")
      .notNull()
      .references(() => performanceAccounts.id, { onDelete: "cascade" }),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => portfolioSnapshots.id, { onDelete: "cascade" }),

    ticker: text("ticker").notNull(),
    name: text("name").notNull(),

    // Weight in basis points (0–10000 = 0%–100% of the account balance).
    // Dollar value is COMPUTED: portfolioAccount.amount × weightBps / 10000.
    // Never store an independent dollar amount — that would create a second
    // total that can silently diverge from the authoritative snapshot balance.
    weightBps: integer("weight_bps").notNull(),

    // Expense ratio as a decimal rate (not basis points).
    // Matches decimal(12,6) convention used by all other rate columns
    // (asset_class_params.mean_return, glide_path_allocations.allocation, etc.).
    // Nullable = user hasn't entered it / FMP returned nothing.
    expenseRatio: decimal("expense_ratio", { precision: 12, scale: 6 }),

    // FK to asset_class_params.id — the same table the MC engine reads.
    // Nullable = not yet classified.
    assetClassId: integer("asset_class_id").references(
      () => assetClassParams.id,
      { onDelete: "set null" },
    ),

    // Source of the asset class assignment — surfaces to user so they
    // know whether to trust or override it.
    // 'fmp' = auto-assigned from FMP sector, 'manual' = user set it.
    assetClassSource: text("asset_class_source")
      .notNull()
      .default("manual")
      .$type<"fmp" | "manual">(),
  },
  (table) => [
    // Unique: one ticker entry per account per snapshot
    uniqueIndex("account_holdings_acct_snap_ticker_idx").on(
      table.performanceAccountId,
      table.snapshotId,
      table.ticker,
    ),
    // FK indexes (PostgreSQL doesn't auto-create these)
    index("account_holdings_perf_acct_idx").on(table.performanceAccountId),
    index("account_holdings_snapshot_idx").on(table.snapshotId),
    index("account_holdings_asset_class_idx").on(table.assetClassId),
    // Weight sanity check (per-row; sum across holdings is validated in the app)
    check(
      "account_holdings_weight_range",
      sql`weight_bps >= 0 AND weight_bps <= 10000`,
    ),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// 8. Net worth (annual)
// ────────────────────────────────────────────────────────────────────────────

export const netWorthAnnual = pgTable("net_worth_annual", {
  id: serial("id").primaryKey(),
  yearEndDate: date("year_end_date").notNull().unique(),
  grossIncome: decimal("gross_income", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  combinedAgi: decimal("combined_agi", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  ssaEarnings: decimal("ssa_earnings", { precision: 14, scale: 2 }),
  effectiveTaxRate: decimal("effective_tax_rate", { precision: 8, scale: 6 }),
  taxesPaid: decimal("taxes_paid", { precision: 14, scale: 2 }),
  // Assets
  cash: decimal("cash", { precision: 14, scale: 2 }).notNull().default("0"),
  houseValue: decimal("house_value", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  retirementTotal: decimal("retirement_total", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  hsa: decimal("hsa", { precision: 14, scale: 2 }).notNull().default("0"),
  ltBrokerage: decimal("lt_brokerage", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  espp: decimal("espp", { precision: 14, scale: 2 }).notNull().default("0"),
  rBrokerage: decimal("r_brokerage", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  otherAssets: decimal("other_assets", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  // Liabilities
  mortgageBalance: decimal("mortgage_balance", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  otherLiabilities: decimal("other_liabilities", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  // Breakdowns
  taxFreeTotal: decimal("tax_free_total", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  taxDeferredTotal: decimal("tax_deferred_total", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  portfolioTotal: decimal("portfolio_total", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  propertyTaxes: decimal("property_taxes", { precision: 14, scale: 2 }),
  // Point-in-time tax location breakdown captured at finalization.
  // Shape: { retirement: { taxFree: N, preTax: N, hsa: N, afterTax: N }, portfolio: { afterTax: N } }
  portfolioByTaxLocation: jsonb("portfolio_by_tax_location")
    .$type<{
      retirement: Record<string, number>;
      portfolio: Record<string, number>;
    }>()
    .notNull(),
});

// Home improvement individual items — cumulative sum per year
export const homeImprovementItems = pgTable("home_improvement_items", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  description: text("description").notNull(),
  cost: decimal("cost", { precision: 14, scale: 2 }).notNull(),
  note: text("note"),
});

// A person's recorded salary + paid bonus for one year — a direct fact,
// the same as every other Historical year-end field (grossIncome,
// combinedAgi, etc). Not derived from a job or any ledger — a job carries
// no salary/bonus of its own (see jobs above), and there is no dated
// raise/bonus history to walk. The current (in-progress) year has no row
// here yet; it auto-fills from the active Salary Profile until recorded.
export const historicalSalaries = pgTable(
  "historical_salaries",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    salary: decimal("salary", { precision: 14, scale: 2 }).notNull(),
    bonus: decimal("bonus", { precision: 14, scale: 2 }).notNull().default("0"),
  },
  (table) => [
    uniqueIndex("historical_salaries_person_year_idx").on(
      table.personId,
      table.year,
    ),
  ],
);

// Other asset items — carry-forward: latest value per name for a given year
export const otherAssetItems = pgTable(
  "other_asset_items",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    year: integer("year").notNull(),
    value: decimal("value", { precision: 14, scale: 2 }).notNull(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("other_asset_items_name_year_idx").on(table.name, table.year),
  ],
);

// Notes on any historical table cell
export const historicalNotes = pgTable(
  "historical_notes",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    field: text("field").notNull(),
    note: text("note").notNull(),
  },
  (table) => [
    uniqueIndex("historical_notes_year_field_idx").on(table.year, table.field),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// 9. Mortgages
// ────────────────────────────────────────────────────────────────────────────

export const mortgageLoans = pgTable(
  "mortgage_loans",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    // Self-reference to this table's own id (the loan this one replaced via
    // refinance). FK constraint (ON DELETE SET NULL, matching
    // savings_goals.parent_goal_id's precedent) added in
    // 0019_mortgage_refinanced_from_fk.sql after a data audit confirmed no
    // orphaned/dangling values — Drizzle can't express a self-reference
    // inline, so the constraint lives in the hand-written migration, not
    // here (same pattern as parent_goal_id).
    refinancedFromId: integer("refinanced_from_id"),
    paidOffDate: date("paid_off_date"),
    principalAndInterest: decimal("principal_and_interest", {
      precision: 14,
      scale: 2,
    }).notNull(),
    pmi: decimal("pmi", { precision: 14, scale: 2 }).notNull().default("0"),
    insuranceAndTaxes: decimal("insurance_and_taxes", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    totalEscrow: decimal("total_escrow", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    interestRate: decimal("interest_rate", {
      precision: 8,
      scale: 6,
    }).notNull(),
    termYears: integer("term_years").notNull(),
    originalLoanAmount: decimal("original_loan_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    firstPaymentDate: date("first_payment_date").notNull(),
    propertyValuePurchase: decimal("property_value_purchase", {
      precision: 14,
      scale: 2,
    }).notNull(),
    propertyValueEstimated: decimal("property_value_estimated", {
      precision: 14,
      scale: 2,
    }),
    usePurchaseOrEstimated: text("use_purchase_or_estimated")
      .notNull()
      .default("purchase"),
    apiBalance: decimal("api_balance", { precision: 14, scale: 2 }),
    apiBalanceDate: date("api_balance_date"),
  },
  (table) => [
    index("mortgage_loans_is_active_idx").on(table.isActive),
    index("mortgage_loans_refinanced_from_id_idx").on(table.refinancedFromId),
  ],
);

export const mortgageWhatIfScenarios = pgTable(
  "mortgage_what_if_scenarios",
  {
    id: serial("id").primaryKey(),
    loanId: integer("loan_id").references(() => mortgageLoans.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    extraMonthlyPrincipal: decimal("extra_monthly_principal", {
      precision: 14,
      scale: 2,
    }).notNull(),
    extraOneTimePayment: decimal("extra_one_time_payment", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    refinanceRate: decimal("refinance_rate", { precision: 8, scale: 6 }),
    refinanceTerm: integer("refinance_term"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("mortgage_what_if_loan_id_idx").on(table.loanId)],
);

export const mortgageExtraPayments = pgTable(
  "mortgage_extra_payments",
  {
    id: serial("id").primaryKey(),
    loanId: integer("loan_id")
      .notNull()
      .references(() => mortgageLoans.id, { onDelete: "cascade" }),
    paymentDate: date("payment_date"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    isActual: boolean("is_actual").notNull().default(false),
    notes: text("notes"),
  },
  (table) => [
    index("mortgage_extra_payments_loan_id_idx").on(table.loanId),
    check(
      "date_pattern_check",
      sql`(payment_date IS NOT NULL AND start_date IS NULL AND end_date IS NULL) OR (payment_date IS NULL AND start_date IS NOT NULL AND end_date IS NOT NULL)`,
    ),
  ],
);

export const propertyTaxes = pgTable(
  "property_taxes",
  {
    id: serial("id").primaryKey(),
    loanId: integer("loan_id")
      .notNull()
      .references(() => mortgageLoans.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    assessedValue: decimal("assessed_value", { precision: 14, scale: 2 }),
    taxAmount: decimal("tax_amount", { precision: 14, scale: 2 }).notNull(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("property_taxes_loan_year_idx").on(table.loanId, table.year),
  ],
);

// Utility services — one row per metered house utility (gas / water / electric).
// Standalone tracker; not yet wired into the budget/projection (additive-ready).
export const utilityService = pgTable(
  "utility_service",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").$type<UtilityKind>().notNull(),
    providerName: text("provider_name").notNull(),
    // Nullable for forward-compat with future utilities that may lack a metered
    // usage unit; seeded gas=ccf, water=gallon, electric=kWh.
    usageUnit: text("usage_unit").$type<UtilityUnit>(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    // Unique by kind makes the spreadsheet import idempotent (one service per kind).
    uniqueIndex("utility_service_kind_idx").on(table.kind),
  ],
);

// Utility readings — one row per service per month (the only stored facts).
// Derived values ($/unit, avg, min/max, totals, YoY) are computed in the router.
export const utilityReading = pgTable(
  "utility_reading",
  {
    id: serial("id").primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => utilityService.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1–12, app-validated (no CHECK; sqlite codegen strips them)
    cost: decimal("cost", { precision: 14, scale: 2 }).notNull(),
    // Nullable: some bills are cost-only (e.g. 2018 move-in year). scale 4 keeps
    // fractional meter reads (e.g. ccf/kWh sub-unit precision) lossless.
    usage: decimal("usage", { precision: 14, scale: 4 }),
    note: text("note"),
  },
  (table) => [
    // Composite unique drives idempotent upserts AND covers the serviceId FK as
    // its leading column, so no separate serviceId index is needed.
    uniqueIndex("utility_reading_service_year_month_idx").on(
      table.serviceId,
      table.year,
      table.month,
    ),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// 10. Retirement settings
// ────────────────────────────────────────────────────────────────────────────

export const retirementSettings = pgTable(
  "retirement_settings",
  {
    id: serial("id").primaryKey(),
    // NOT bare .unique() any more (Retirement Profiles step C — advisor
    // reviewed 2026-08-30). One row per person, PER PROFILE, not one row
    // per person system-wide — see the composite unique index below. This
    // is what makes a second retirement profile able to hold genuinely
    // different household settings; without it there was nowhere to put a
    // duplicated profile's row (unique(person_id) forbade the INSERT).
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    retirementAge: integer("retirement_age").notNull(),
    endAge: integer("end_age").notNull(),
    returnAfterRetirement: decimal("return_after_retirement", {
      precision: 8,
      scale: 6,
    }).notNull(),
    annualInflation: decimal("annual_inflation", {
      precision: 8,
      scale: 6,
    }).notNull(),
    postRetirementInflation: decimal("post_retirement_inflation", {
      precision: 8,
      scale: 6,
    }),
    salaryAnnualIncrease: decimal("salary_annual_increase", {
      precision: 8,
      scale: 6,
    }).notNull(),
    salaryCap: decimal("salary_cap", { precision: 14, scale: 2 }),
    raisesDuringRetirement: boolean("raises_during_retirement")
      .notNull()
      .default(false),
    /** Per-person Rule of 55 forecasting override (v0.7.8). True (default)
     *  ⇒ no override — the engine's computed Rule of 55 status (from real
     *  job separation data) is used unchanged. False ⇒ force this person's
     *  employer-plan accounts ineligible for Rule of 55, regardless of what
     *  the computed status says — for forecasting "what if I'm not at a
     *  qualifying job when I retire." Deliberately one-directional: this
     *  never forces eligibility TRUE, only FALSE, so a default-true row can
     *  never silently paint an account eligible when the real computed
     *  status says otherwise. */
    ruleOf55Override: boolean("rule_of_55_override").notNull().default(true),
    withdrawalRate: decimal("withdrawal_rate", { precision: 8, scale: 6 })
      .notNull()
      .default(DEFAULT_WITHDRAWAL_RATE.toString()),
    taxMultiplier: decimal("tax_multiplier", { precision: 8, scale: 6 })
      .notNull()
      .default("1.0"),
    grossUpForTaxes: boolean("gross_up_for_taxes").notNull().default(true),
    /** Target marginal rate for Roth optimization (e.g. 0.12 = stay in 12% bracket). Null = disabled. */
    rothBracketTarget: decimal("roth_bracket_target", {
      precision: 8,
      scale: 6,
    }).default("0.12"),
    /** Monthly Social Security benefit estimate in today's dollars. */
    socialSecurityMonthly: decimal("social_security_monthly", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("2500"),
    /** Age at which Social Security income begins. */
    ssStartAge: integer("ss_start_age").notNull().default(67),
    /** Enable automatic Roth conversions during decumulation (fills target bracket). */
    enableRothConversions: boolean("enable_roth_conversions")
      .notNull()
      .default(false),
    /** Target marginal rate for Roth conversions (null = inherit from rothBracketTarget). */
    rothConversionTarget: decimal("roth_conversion_target", {
      precision: 8,
      scale: 6,
    }),
    /** Withdrawal/spending strategy (see withdrawal-strategies.ts registry). */
    withdrawalStrategy: varchar("withdrawal_strategy", { length: 30 })
      .notNull()
      .default("fixed"),
    /** R55 follow-up: within the cost-ranked tier (beyond the Traditional
     *  bracket-fill target), which of Roth basis / brokerage's 0%-LTCG room
     *  drains first. "roth_first" (default) matches all pre-existing
     *  behavior. "brokerage_first" is an explicit household opt-in — a
     *  brokerage LTCG gain still counts toward MAGI for ACA/IRMAA purposes
     *  even when taxed at 0% federally, so this trades a real ACA/IRMAA
     *  cost (when either awareness setting is on) for using the "use it or
     *  lose it" annual 0%-LTCG allowance sooner — an explicit, user-chosen
     *  tradeoff (with UI warning text), not an automatic optimization. */
    discretionaryWithdrawalOrder: varchar("discretionary_withdrawal_order", {
      length: 20,
    })
      .notNull()
      .default("roth_first"),
    /** G-K: upper guardrail — if currentRate < initialRate × this, increase spending (e.g. 0.80). */
    gkUpperGuardrail: decimal("gk_upper_guardrail", {
      precision: 8,
      scale: 6,
    }).default("0.80"),
    /** G-K: lower guardrail — if currentRate > initialRate × this, decrease spending (e.g. 1.20). */
    gkLowerGuardrail: decimal("gk_lower_guardrail", {
      precision: 8,
      scale: 6,
    }).default("1.20"),
    /** G-K: spending increase percentage when upper guardrail triggers (e.g. 0.10 = 10%). */
    gkIncreasePct: decimal("gk_increase_pct", {
      precision: 8,
      scale: 6,
    }).default("0.10"),
    /** G-K: spending decrease percentage when lower guardrail triggers (e.g. 0.10 = 10%). */
    gkDecreasePct: decimal("gk_decrease_pct", {
      precision: 8,
      scale: 6,
    }).default("0.10"),
    /** G-K: skip inflation adjustment in years following a portfolio loss. */
    gkSkipInflationAfterLoss: boolean("gk_skip_inflation_after_loss")
      .notNull()
      .default(true),
    /** Spending Decline: annual real decline rate (e.g. 0.02 = 2%). */
    sdAnnualDeclineRate: decimal("sd_annual_decline_rate", {
      precision: 12,
      scale: 6,
    }).default("0.02"),
    /** Constant Percentage: withdrawal % of current balance. */
    cpWithdrawalPercent: decimal("cp_withdrawal_percent", {
      precision: 12,
      scale: 6,
    }).default("0.05"),
    /** Constant Percentage: floor as % of initial withdrawal. */
    cpFloorPercent: decimal("cp_floor_percent", {
      precision: 12,
      scale: 6,
    }).default("0.90"),
    /** Endowment: withdrawal % of rolling average balance. */
    enWithdrawalPercent: decimal("en_withdrawal_percent", {
      precision: 12,
      scale: 6,
    }).default("0.05"),
    /** Endowment: rolling window in years. */
    enRollingYears: integer("en_rolling_years").default(10),
    /** Endowment: floor as % of initial withdrawal. */
    enFloorPercent: decimal("en_floor_percent", {
      precision: 12,
      scale: 6,
    }).default("0.90"),
    /** Vanguard Dynamic: base withdrawal %. */
    vdBasePercent: decimal("vd_base_percent", {
      precision: 12,
      scale: 6,
    }).default("0.05"),
    /** Vanguard Dynamic: max YoY spending increase. */
    vdCeilingPercent: decimal("vd_ceiling_percent", {
      precision: 12,
      scale: 6,
    }).default("0.05"),
    /** Vanguard Dynamic: max YoY spending decrease. */
    vdFloorPercent: decimal("vd_floor_percent", {
      precision: 12,
      scale: 6,
    }).default("0.025"),
    /** RMD Spending: multiplier on IRS RMD amount. */
    rmdMultiplier: decimal("rmd_multiplier", {
      precision: 12,
      scale: 6,
    }).default("1.0"),
    /** R46: what to do with RMD-forced withdrawal beyond stated spending
     *  need (after any QCD reduces the taxable RMD first) — "reinvest"
     *  into brokerage (default, matches all pre-R46 behavior) or "spend"
     *  (household consumes it; net worth ends up lower, by design). */
    rmdExcessHandling: varchar("rmd_excess_handling", { length: 20 })
      .notNull()
      .default("reinvest"),
    /** R46: automatically apply the largest Qualified Charitable
     *  Distribution the household's RMD situation allows each year
     *  (capped by QCD_ANNUAL_CAP_PER_PERSON and the person's IRA-only
     *  Traditional balance — see constants.ts and
     *  PLAN-rmd-excess-handling.md for the approximation this uses).
     *  Excludes that portion of RMD from taxable income entirely. */
    qcdMaximize: boolean("qcd_maximize").notNull().default(false),
    /** R47: proactively size Roth conversions to shrink a FUTURE RMD
     *  toward projected spending need, not just fill this year's bracket
     *  room opportunistically — default false, byte-identical for every
     *  existing household until explicitly turned on (converting more
     *  Traditional-to-Roth earlier is a real pay-tax-now-vs-later
     *  tradeoff). Per-person, requires individual-account tracking — see
     *  PLAN-r47-rmd-aware-roth-smoothing.md. */
    rmdSmoothingEnabled: boolean("rmd_smoothing_enabled")
      .notNull()
      .default(false),
    /** R47: how far smoothing may raise the EFFECTIVE conversion target
     *  rate above the household's own `rothBracketTarget`/
     *  `rothConversionTarget` when it needs more room than those provide
     *  — can only RAISE the effective ceiling, never lower it (a
     *  household's existing, separately-configured target always wins if
     *  it's already higher). Null = not yet set; UI should seed a new
     *  household's default from their current `rothBracketTarget`, not a
     *  hardcoded value, so opting into smoothing can never look like it
     *  silently lowered an existing target. */
    rmdSmoothingMaxBracketTarget: decimal("rmd_smoothing_max_bracket_target", {
      precision: 8,
      scale: 6,
    }),
    /** Enable IRMAA awareness — constrain Roth conversions/withdrawals near Medicare surcharge cliffs (65+). */
    enableIrmaaAwareness: boolean("enable_irmaa_awareness")
      .notNull()
      .default(false),
    /** Enable ACA subsidy awareness — cap MAGI to preserve health insurance subsidies (pre-65). */
    enableAcaAwareness: boolean("enable_aca_awareness")
      .notNull()
      .default(false),
    /** Household size for ACA FPL calculation. */
    householdSize: integer("household_size").notNull().default(2),
    /** Filing status for retirement projections. Backfilled from the
     *  person's active job's W-4 filing status (drizzle/0021), then made
     *  NOT NULL — the job-facts fallback tier in build-engine-payload.ts
     *  stays in place until this column is reliably non-null for every
     *  household, but no new row can be inserted without one. */
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),

    // --- Retirement Profiles migration, step A (expand) ---------------------
    // Added additively; nothing reads them yet (step B switches the reads).
    // See .scratch/docs/plans — "Making Retirement a First-Class Profile".

    /** The profile this row belongs to. Together with `person_id` this is
     *  now the row's real key (see the composite unique index below,
     *  replacing the old bare unique(person_id) — step C, 2026-08-30): one
     *  row per person PER PROFILE, which is what lets two profiles hold
     *  genuinely different household settings.
     *
     *  Still nullable, not NOT NULL — `retirementSettings.upsert`
     *  (server/routers/retirement.ts) explicitly resolves and sets it on
     *  every write (falling back to `isNull` scoping, never a bare
     *  personId match, when no profile resolves), and a null value can't
     *  weaken the unique index (Postgres/SQLite both treat NULL as
     *  non-equal there), so there is no correctness gap. Made NOT NULL
     *  ONLY as part of the v0.8.0 squash: SQLite has no ALTER COLUMN SET NOT
     *  NULL, so tightening this now would force the exact table-recreate
     *  path this schema has otherwise avoided since step A. */
    profileId: integer("profile_id").references(() => retirementProfiles.id, {
      onDelete: "cascade",
    }),

    /** Distribution tax rates, relocated from `retirement_scenarios` — a
     *  table with live engine reads but ZERO UI (its CRUD router has no
     *  callers), so these values changed every projection while being
     *  invisible and uneditable. Backfilled from the `is_selected` row.
     *
     *  Household-grain, so every person's row carries the same value, matching
     *  how the other household columns here already behave.
     *
     *  DELIBERATELY NULLABLE, against the usual "NOT NULL on financial amount
     *  columns" convention. Today's read is `selectedScenario ? rate : 0` —
     *  i.e. no selected row means 0, NOT the DEFAULT_TAX_RATE_* constants.
     *  Backfilling a literal 0 would preserve behaviour but permanently
     *  destroy the difference between "the household chose 0%" and "there was
     *  no row", and the open question of whether these should actually be the
     *  defaults needs that distinction to remain answerable. So: null means
     *  absent, and the read stays `!= null ? rate : 0` — byte-identical
     *  output, no information laundered away.
     *
     *  NOTE: `retirement_scenarios.withdrawal_rate` is deliberately NOT
     *  relocated here. `retirement_settings.withdrawal_rate` (line ~1400)
     *  already exists, is NOT NULL, and is read in eight+ places; the
     *  scenarios one is a different value overriding it in exactly one
     *  consumer (the relocation tool). Collapsing them is correct eventually
     *  but is a user-visible behaviour change, not a behaviour-neutral
     *  relocation, so it gets its own change and its own justification. */
    distributionTaxRateTraditional: decimal(
      "distribution_tax_rate_traditional",
      {
        precision: 8,
        scale: 6,
      },
    ),
    distributionTaxRateRoth: decimal("distribution_tax_rate_roth", {
      precision: 8,
      scale: 6,
    }),
    distributionTaxRateHsa: decimal("distribution_tax_rate_hsa", {
      precision: 8,
      scale: 6,
    }),
    distributionTaxRateBrokerage: decimal("distribution_tax_rate_brokerage", {
      precision: 8,
      scale: 6,
    }),
  },
  (table) => [
    index("retirement_settings_person_id_idx").on(table.personId),
    index("retirement_settings_profile_id_idx").on(table.profileId),
    // Replaces the old bare unique(person_id). profile_id stays nullable
    // (Postgres/SQLite both treat NULL as non-equal in a unique index, so
    // this can't be weakened by a null profile_id — every write path sets
    // one) rather than made NOT NULL now, which would force SQLite's
    // recreate-table path for no benefit; that tightening folds into the
    // v0.8.0 squash alongside the rest of the deferred contract step.
    uniqueIndex("retirement_settings_profile_person_unq").on(
      table.profileId,
      table.personId,
    ),
  ],
);

/**
 * Retirement Profiles — the named, swappable entity.
 *
 * Thin parent matching `contribution_profiles` / `salary_profiles`: id, name,
 * description, created_at. The assumptions themselves stay on
 * `retirement_settings` (re-keyed to `profile_id`) rather than moving into a
 * JSON payload like its siblings, because 24 of those columns are typed
 * decimals with explicit precision — moving them to JSON would turn financial
 * rates into floats and discard every validator and default binding.
 *
 * Each profile is a COMPLETE world: no baseline, no default profile, no
 * inheritance, no merge at read time. Same contract Salary Profiles already
 * state ("no fallback to a job record: if you want a different number, use a
 * different profile").
 */
export const retirementProfiles = pgTable("retirement_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  /**
   * Tax-law year this profile's projections are priced under (R43).
   * NULL = track the latest enacted tax data — the historical behaviour, so
   * every pre-R43 profile is byte-identical after the migration adds this
   * column. A non-null value pins the `resolveTaxParams` base year (with
   * `onMissing: "nearest"`); "Latest = current law" in the profile
   * assumptions UI.
   */
  taxParamsYear: integer("tax_params_year"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Per-person retirement assumptions within a profile.
 *
 * Only the fields the engine genuinely reads per person live here. Everything
 * else is household-grain and stays on `retirement_settings` — see the design
 * plan's §01 for why the household/per-person line falls where it does.
 *
 * `end_age` is here because the engine reads it per person
 * (`Math.max(...perPersonSettings.map(p => p.endAge))` →
 * `projectionEndAge`), which is also what made the household "Plan Through"
 * control silently discard edits before commit 0b5d5fe.
 *
 * COMPLETENESS INVARIANT: every profile must hold a row for every person.
 * With no baseline to fall back to, a missing row is a missing retirement
 * age — not a number the engine can invent. Enforced on profile create,
 * duplicate, person create (fan a row into every existing profile — the one
 * that gets forgotten), and person delete.
 */
export const retirementProfilePeople = pgTable(
  "retirement_profile_people",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => retirementProfiles.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    retirementAge: integer("retirement_age").notNull(),
    endAge: integer("end_age").notNull(),
    socialSecurityMonthly: decimal("social_security_monthly", {
      precision: 14,
      scale: 2,
    }),
    ssStartAge: integer("ss_start_age"),
    ruleOf55Override: boolean("rule_of_55_override"),
    salaryAnnualIncrease: decimal("salary_annual_increase", {
      precision: 8,
      scale: 6,
    }),
  },
  (table) => [
    uniqueIndex("retirement_profile_people_profile_person_unq").on(
      table.profileId,
      table.personId,
    ),
    index("retirement_profile_people_profile_id_idx").on(table.profileId),
    index("retirement_profile_people_person_id_idx").on(table.personId),
  ],
);

export const retirementSalaryOverrides = pgTable(
  "retirement_salary_overrides",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    projectionYear: integer("projection_year").notNull(),
    overrideSalary: decimal("override_salary", {
      precision: 14,
      scale: 2,
    }).notNull(),
    /** Contribution Profile this year switches to (contribution side only). */
    contributionProfileId: integer("contribution_profile_id").references(
      () => contributionProfiles.id,
      { onDelete: "set null" },
    ),
    /** Salary Profile this year switches to. Independent of
     *  contributionProfileId — only this row's own personId's entry from the
     *  referenced profile is injected (the table's grain is per person-year). */
    salaryProfileId: integer("salary_profile_id").references(
      () => salaryProfiles.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
  },
  (table) => [
    uniqueIndex("retirement_salary_overrides_person_year_idx").on(
      table.personId,
      table.projectionYear,
    ),
    index("retirement_salary_overrides_person_id_idx").on(table.personId),
    index("retirement_salary_overrides_contribution_profile_id_idx").on(
      table.contributionProfileId,
    ),
    index("retirement_salary_overrides_salary_profile_id_idx").on(
      table.salaryProfileId,
    ),
  ],
);

export const retirementBudgetOverrides = pgTable(
  "retirement_budget_overrides",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    projectionYear: integer("projection_year").notNull(),
    overrideMonthlyBudget: decimal("override_monthly_budget", {
      precision: 14,
      scale: 2,
    }).notNull(),
    notes: text("notes"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
  },
  (table) => [
    uniqueIndex("retirement_budget_overrides_person_year_idx").on(
      table.personId,
      table.projectionYear,
    ),
    index("retirement_budget_overrides_person_id_idx").on(table.personId),
  ],
);

export const projectionOverrides = pgTable(
  "projection_overrides",
  {
    id: serial("id").primaryKey(),
    overrideType: text("override_type").notNull(),
    overrides: jsonb("overrides").$type<Record<string, unknown>[]>().notNull(),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
  },
  (table) => [
    uniqueIndex("projection_overrides_type_idx").on(table.overrideType),
  ],
);

export const retirementScenarios = pgTable("retirement_scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  withdrawalRate: decimal("withdrawal_rate", {
    precision: 8,
    scale: 6,
  }).notNull(),
  targetAnnualIncome: decimal("target_annual_income", {
    precision: 14,
    scale: 2,
  }).notNull(),
  annualInflation: decimal("annual_inflation", {
    precision: 8,
    scale: 6,
  }).notNull(),
  distributionTaxRateTraditional: decimal("distribution_tax_rate_traditional", {
    precision: 8,
    scale: 6,
  })
    .notNull()
    .default("0.22"),
  distributionTaxRateRoth: decimal("distribution_tax_rate_roth", {
    precision: 8,
    scale: 6,
  })
    .notNull()
    .default("0"),
  distributionTaxRateHsa: decimal("distribution_tax_rate_hsa", {
    precision: 8,
    scale: 6,
  })
    .notNull()
    .default("0"),
  distributionTaxRateBrokerage: decimal("distribution_tax_rate_brokerage", {
    precision: 8,
    scale: 6,
  })
    .notNull()
    .default("0.15"),
  isLtBrokerageEnabled: boolean("is_lt_brokerage_enabled")
    .notNull()
    .default(true),
  ltBrokerageAnnualContribution: decimal("lt_brokerage_annual_contribution", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),
  isSelected: boolean("is_selected").notNull().default(false),
  notes: text("notes"),
});

// ────────────────────────────────────────────────────────────────────────────
// 11. Return rates & tax tables
// ────────────────────────────────────────────────────────────────────────────

export const returnRateTable = pgTable("return_rate_table", {
  id: serial("id").primaryKey(),
  age: integer("age").notNull().unique(),
  rateOfReturn: decimal("rate_of_return", { precision: 8, scale: 6 }).notNull(),
});

export type TaxBracketEntry = {
  threshold: number;
  baseWithholding: number;
  rate: number;
};

export const taxBrackets = pgTable(
  "tax_brackets",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    w4Checkbox: boolean("w4_checkbox").notNull(),
    brackets: jsonb("brackets").$type<TaxBracketEntry[]>().notNull(),
  },
  (table) => [
    uniqueIndex("tax_brackets_year_status_checkbox_idx").on(
      table.taxYear,
      table.filingStatus,
      table.w4Checkbox,
    ),
  ],
);

// ── LTCG brackets ───────────────────────────────────────────────

export type LtcgBracketEntry = {
  threshold: number | null; // null = Infinity (top bracket)
  rate: number;
};

export const ltcgBrackets = pgTable(
  "ltcg_brackets",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    brackets: jsonb("brackets").$type<LtcgBracketEntry[]>().notNull(),
  },
  (table) => [
    uniqueIndex("ltcg_brackets_year_status_idx").on(
      table.taxYear,
      table.filingStatus,
    ),
  ],
);

// ── IRMAA brackets ──────────────────────────────────────────────

export type IrmaaBracketEntry = {
  magiThreshold: number;
  annualSurcharge: number;
};

export const irmaaBrackets = pgTable(
  "irmaa_brackets",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    brackets: jsonb("brackets").$type<IrmaaBracketEntry[]>().notNull(),
  },
  (table) => [
    uniqueIndex("irmaa_brackets_year_status_idx").on(
      table.taxYear,
      table.filingStatus,
    ),
  ],
);

// ── ACA Federal Poverty Level ──────────────────────────────────
//
// R43: FPL was the one annually-indexed federal figure set with no DB home
// (it lived only in `aca-tables.ts`'s `FPL_BY_HOUSEHOLD`). One row per ACA
// COVERAGE year (not the HHS publication year, which is one calendar year
// earlier — see aca-tables.ts). `amounts` maps household size "1".."8" to
// the annual FPL dollar figure.

export const fplByHousehold = pgTable(
  "fpl_by_household",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    amounts: jsonb("amounts").$type<Record<string, number>>().notNull(),
  },
  (table) => [uniqueIndex("fpl_by_household_year_idx").on(table.taxYear)],
);

// ── Tax-parameter vintage rows ─────────────────────────────────
//
// R43: a thin per-year vintage marker. It carries NO figure values — the
// existing `contribution_limits` / `tax_brackets` / `ltcg_brackets` /
// `irmaa_brackets` / `fpl_by_household` tables remain the one and only value
// store. `resolveTaxParams` maps a requested year to a resolved year via
// these rows, then reads the value tables for that year. `version` is a
// human-legible "Tax data: 2026, rev N" counter — cache coherence comes from
// the resolved values themselves (already in the engine-input hash), not
// from this column. Absent entirely (old-backup restore) ⇒ the resolver
// falls back to the value tables' own MAX(tax_year), i.e. today's behaviour.

export const taxParams = pgTable(
  "tax_params",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    version: integer("version").notNull().default(1),
    source: text("source"),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("tax_params_year_idx").on(table.taxYear),
    // R43 follow-up (schema-reviewer suggestion): version is a monotonic
    // "Tax data: 2026, rev N" revision counter — never meaningfully zero
    // or negative. Cheap to enforce now, before any admin-facing mutation
    // of this column ships.
    // prettier-ignore
    check(
      "tax_params_version_positive",
      sql`version > 0`,
    ),
  ],
);

export type ApiConfig = Record<string, string | undefined>;

export type AccountMapping = {
  // "performance:{id}" | "asset:{id}" | "mortgage:{loanId}:{type}" (legacy
  // prefix format) | "cash" | "creditCard" (fixed pseudo-accounts — many
  // mappings can share these two values, summed by getEffectiveCash /
  // getEffectiveCreditCardDebt; never resolve to a single Ledgr row the
  // way the others do, and applyPullMapping skips them on purpose).
  localId?: string;
  localName: string; // Cached display name (UI only, not for resolution)
  remoteAccountId: string;
  syncDirection: "pull" | "push" | "both";
  // Typed ID fields — preferred over parsing localId prefix strings
  assetId?: number; // Direct reference to otherAssetItems.id
  loanId?: number; // Direct reference to mortgageLoans.id
  loanMapType?: "propertyValue" | "loanBalance"; // What the mortgage mapping controls
  performanceAccountId?: number; // Direct reference to performanceAccounts.id
};

// ────────────────────────────────────────────────────────────────────────────
// 12. API sync
// ────────────────────────────────────────────────────────────────────────────

export const apiConnections = pgTable(
  "api_connections",
  {
    id: serial("id").primaryKey(),
    service: text("service").notNull().unique(),
    config: jsonb("config").$type<ApiConfig>().notNull(),
    accountMappings: jsonb("account_mappings").$type<AccountMapping[]>(),
    skippedCategoryIds: jsonb("skipped_category_ids").$type<string[]>(),
    // References budgetProfiles.id — no DB-level FK constraint. Always
    // resolved via allProfiles.find(p => p.id === conn.linkedProfileId) in
    // server code (budget.ts, sync/core.ts); despite the generic name it
    // is never polymorphic across other tables.
    linkedProfileId: integer("linked_profile_id"),
    linkedColumnIndex: integer("linked_column_index"),
    serverKnowledge: integer("server_knowledge"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (table) => [
    index("api_connections_linked_profile_id_idx").on(table.linkedProfileId),
  ],
);

export const budgetApiCache = pgTable(
  "budget_api_cache",
  {
    id: serial("id").primaryKey(),
    service: text("service").$type<BudgetApiService>().notNull(),
    cacheKey: text("cache_key").notNull(),
    data: jsonb("data").$type<unknown>().notNull(),
    serverKnowledge: integer("server_knowledge"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("budget_api_cache_service_key_idx").on(
      table.service,
      table.cacheKey,
    ),
  ],
);

/**
 * Server-side cache for retirement projection results (deterministic
 * engine + Monte Carlo + Coast FIRE MC) — a new table rather than reusing
 * budgetApiCache. That table's `service` column is the argument to a
 * DESTRUCTIVE operation (cacheClear drops-and-repulls a remote budget-API
 * mirror); a projection cache has no upstream to re-pull from, and
 * `serverKnowledge` (a YNAB delta-sync cursor) has no equivalent here. Its
 * keyspace is also small and bounded ("categories", "months/YYYY-MM-01");
 * this one is a hash per distinct input combination, unbounded, so it
 * needs its own eviction (expiresAt + lastReadAt), which budgetApiCache's
 * helpers don't provide.
 *
 * `seed` is stored WITH the cached result, not as a separate persisted
 * setting: on a cache miss a fresh random seed is generated and stored
 * alongside the result; on a hit, the ALREADY-STORED seed is what
 * determined that stored result, so returning it is honestly
 * reproducible — "this exact run really would produce this answer" —
 * rather than silently freezing a stochastic simulation's randomness
 * under a key that implies full determinism. A cache MISS (new inputs)
 * always gets a new seed; "Re-run simulation" forces a miss.
 */
export const projectionCache = pgTable(
  "projection_cache",
  {
    id: serial("id").primaryKey(),
    /** sha256 of the canonicalized engine input this row was computed
     *  from — see hashEngineInput in server/helpers/projection-cache.ts.
     *  Different per procedure (deterministic vs MC vs Coast-FIRE MC
     *  inputs differ), so the kind is folded into the hash input itself
     *  rather than a separate column. */
    inputHash: text("input_hash").notNull(),
    /** Random seed used for this computation — null for the deterministic
     *  engine result, which has no randomness to seed. */
    seed: integer("seed"),
    result: jsonb("result").$type<unknown>().notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Bumped whenever the engine's computation logic changes in a way
     *  that could change output for the same inputs — auto-invalidates
     *  stale-shaped/stale-computed rows after a deploy without needing a
     *  manual cache-clear. See PROJECTION_CACHE_ENGINE_VERSION. */
    engineVersion: integer("engine_version").notNull(),
  },
  (table) => [
    uniqueIndex("projection_cache_hash_version_idx").on(
      table.inputHash,
      table.engineVersion,
    ),
    index("projection_cache_expires_at_idx").on(table.expiresAt),
  ],
);

export const simplefinBalanceSnapshots = pgTable(
  "simplefin_balance_snapshots",
  {
    id: serial("id").primaryKey(),
    snapshotDate: date("snapshot_date").notNull().unique(),
    totalBalance: decimal("total_balance", {
      precision: 14,
      scale: 2,
    }).notNull(),
    accountCount: integer("account_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("simplefin_balance_snapshots_date_idx").on(table.snapshotDate),
  ],
);

export const simplefinAccounts = pgTable(
  "simplefin_accounts",
  {
    id: serial("id").primaryKey(),
    externalAccountId: text("external_account_id").notNull().unique(),
    orgName: text("org_name").notNull(),
    accountName: text("account_name").notNull(),
    lastBalance: decimal("last_balance", {
      precision: 14,
      scale: 2,
    }).notNull(),
    isIncluded: boolean("is_included").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    linkedPerformanceAccountId: integer(
      "linked_performance_account_id",
    ).references(() => performanceAccounts.id, { onDelete: "set null" }),
  },
  (table) => [
    index("simplefin_accounts_org_name_idx").on(
      table.orgName,
      table.accountName,
    ),
    index("simplefin_accounts_linked_perf_account_idx").on(
      table.linkedPerformanceAccountId,
    ),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// 13. App config / admin
// ────────────────────────────────────────────────────────────────────────────

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value").$type<unknown>().notNull(),
});

// --- Local admin accounts ---

export const localAdmins = pgTable("local_admins", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Relocation scenarios ---

export type RelocationScenarioParams = {
  currentProfileId: number;
  currentBudgetColumn: number;
  currentExpenseOverride: number | null;
  relocationProfileId: number;
  relocationBudgetColumn: number;
  relocationExpenseOverride: number | null;
  yearAdjustments: {
    year: number;
    monthlyExpenses: number;
    profileId?: number;
    budgetColumn?: number;
    notes?: string;
  }[];
  largePurchases: {
    name: string;
    purchasePrice: number;
    downPaymentPercent?: number;
    loanRate?: number;
    loanTermYears?: number;
    ongoingMonthlyCost?: number;
    saleProceeds?: number;
    purchaseYear: number;
  }[];
  currentContributionProfileId: number | null;
  relocationContributionProfileId: number | null;
  moveYear: number | null;
};

// ────────────────────────────────────────────────────────────────────────────
// 14. Scenarios (relocation, generic)
// ────────────────────────────────────────────────────────────────────────────

export const relocationScenarios = pgTable("relocation_scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  params: jsonb("params").$type<RelocationScenarioParams>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Scenario overrides (global what-if system) ---

/** Nested override map: { entityType: { recordId: { field: value } } } */
export type ScenarioOverrides = Record<
  string,
  Record<string, Record<string, unknown>>
>;

export const scenarios = pgTable(
  "scenarios",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    overrides: jsonb("overrides")
      .$type<ScenarioOverrides>()
      .notNull()
      .default({}),
    isBaseline: boolean("is_baseline").notNull().default(false),
    /** Pins which Budget Profile is "active" for every page/calculator when this
     *  Plan is selected, instead of the globally-active budget_profiles row.
     *  A reference pin, not a value override — deliberately a dedicated FK
     *  column rather than a generic `overrides` entry (see docs/RULES.md). */
    budgetProfileId: integer("budget_profile_id").references(
      () => budgetProfiles.id,
      { onDelete: "set null" },
    ),
    /** Pins which Contribution Profile is "active" for this Plan — see budgetProfileId. */
    contributionProfileId: integer("contribution_profile_id").references(
      () => contributionProfiles.id,
      { onDelete: "set null" },
    ),
    /** Pins which Salary Profile is "active" for this Plan — see budgetProfileId.
     *  Independent of contributionProfileId: a Plan can pin either, both, or
     *  neither. */
    salaryProfileId: integer("salary_profile_id").references(
      () => salaryProfiles.id,
      { onDelete: "set null" },
    ),
    /** Sets which Retirement Profile is active for this Plan — the fourth
     *  profile axis, alongside budget/contribution/salary above. `null` means
     *  this Plan sets nothing for retirement and resolution falls through to
     *  the global active profile; never backfill it to a real id, which would
     *  convert "sets nothing" into "sets profile 1" for every existing Plan. */
    retirementProfileId: integer("retirement_profile_id").references(
      () => retirementProfiles.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("scenarios_budget_profile_id_idx").on(table.budgetProfileId),
    index("scenarios_contribution_profile_id_idx").on(
      table.contributionProfileId,
    ),
    index("scenarios_salary_profile_id_idx").on(table.salaryProfileId),
    index("scenarios_retirement_profile_id_idx").on(table.retirementProfileId),
  ],
);

// --- Monte Carlo: Asset class parameters and glide path ---

// ────────────────────────────────────────────────────────────────────────────
// 15. Monte Carlo (asset classes + presets + glide paths)
// ────────────────────────────────────────────────────────────────────────────

export const assetClassParams = pgTable(
  "asset_class_params",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    meanReturn: decimal("mean_return", { precision: 12, scale: 6 }).notNull(),
    stdDev: decimal("std_dev", { precision: 12, scale: 6 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [index("asset_class_params_is_active_idx").on(table.isActive)],
);

export const assetClassCorrelations = pgTable(
  "asset_class_correlations",
  {
    id: serial("id").primaryKey(),
    classAId: integer("class_a_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    classBId: integer("class_b_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    correlation: decimal("correlation", { precision: 12, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex("asset_class_correlations_pair_idx").on(
      table.classAId,
      table.classBId,
    ),
    index("asset_class_correlations_class_a_idx").on(table.classAId),
    index("asset_class_correlations_class_b_idx").on(table.classBId),
  ],
);

export const glidePathAllocations = pgTable(
  "glide_path_allocations",
  {
    id: serial("id").primaryKey(),
    age: integer("age").notNull(),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    allocation: decimal("allocation", { precision: 12, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex("glide_path_age_class_idx").on(table.age, table.assetClassId),
    index("glide_path_asset_class_idx").on(table.assetClassId),
  ],
);

// --- Monte Carlo: Presets (DB-driven, replaces hardcoded MC_PRESETS) ---

export const mcPresets = pgTable(
  "mc_presets",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull().unique(), // 'aggressive', 'default', 'conservative'
    label: text("label").notNull(),
    description: text("description").notNull(),
    returnMultiplier: decimal("return_multiplier", { precision: 12, scale: 6 })
      .notNull()
      .default("1.000000"),
    volMultiplier: decimal("vol_multiplier", { precision: 12, scale: 6 })
      .notNull()
      .default("1.000000"),
    inflationMean: decimal("inflation_mean", { precision: 12, scale: 6 })
      .notNull()
      .default("0.025000"),
    inflationStdDev: decimal("inflation_std_dev", { precision: 12, scale: 6 })
      .notNull()
      .default("0.012000"),
    defaultTrials: integer("default_trials").notNull().default(5000),
    returnClampMin: decimal("return_clamp_min", { precision: 12, scale: 6 })
      .notNull()
      .default("-0.500000"),
    returnClampMax: decimal("return_clamp_max", { precision: 12, scale: 6 })
      .notNull()
      .default("1.000000"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [index("mc_presets_is_active_idx").on(table.isActive)],
);

export const mcPresetGlidePaths = pgTable(
  "mc_preset_glide_paths",
  {
    id: serial("id").primaryKey(),
    presetId: integer("preset_id")
      .notNull()
      .references(() => mcPresets.id, { onDelete: "cascade" }),
    age: integer("age").notNull(),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    allocation: decimal("allocation", { precision: 12, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex("mc_preset_gp_idx").on(
      table.presetId,
      table.age,
      table.assetClassId,
    ),
    index("mc_preset_gp_preset_idx").on(table.presetId),
    index("mc_preset_gp_asset_class_idx").on(table.assetClassId),
  ],
);

export const mcPresetReturnOverrides = pgTable(
  "mc_preset_return_overrides",
  {
    id: serial("id").primaryKey(),
    presetId: integer("preset_id")
      .notNull()
      .references(() => mcPresets.id, { onDelete: "cascade" }),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    meanReturn: decimal("mean_return", { precision: 12, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex("mc_preset_ro_idx").on(table.presetId, table.assetClassId),
    index("mc_preset_ro_asset_class_idx").on(table.assetClassId),
  ],
);

// --- Monte Carlo: User-created simulation presets ---

export const mcUserPresets = pgTable("mc_user_presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  simulations: integer("simulations").notNull().default(1000),
  returnMean: decimal("return_mean", { precision: 12, scale: 6 }).notNull(),
  returnStdDev: decimal("return_std_dev", {
    precision: 12,
    scale: 6,
  }).notNull(),
  inflationMean: decimal("inflation_mean", {
    precision: 12,
    scale: 6,
  }).notNull(),
  inflationStdDev: decimal("inflation_std_dev", {
    precision: 12,
    scale: 6,
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Contribution profiles (what-if contribution overrides) ---

// ────────────────────────────────────────────────────────────────────────────
// 16. Contribution profiles
// ────────────────────────────────────────────────────────────────────────────

export const contributionProfiles = pgTable("contribution_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  contributionActiveFields: jsonb("contribution_active_fields")
    .$type<ScenarioOverrides>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Salary profiles (per-job salary entries) ---
//
// A first-class sibling of Budget Profile / Contribution Profile: a named set
// of per-job salary ENTRIES that any page can preview under. Deliberately
// separate from contribution_profiles so "what if I earned X" and "what if I
// contributed Y" are two independent axes rather than one coupled entity.
//
// Every profile is an ordinary row — there is no `isDefault` column and no
// synthetic id-0 "Live" row. An id either resolves to a real row or is an
// error; it is never a sentinel.
//
// A job carries no salary or bonus terms of its own. `salaries` is a jobId →
// COMPLETE entry map — see the docblock on the column below.

export const salaryProfiles = pgTable("salary_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  /** jobId → complete salary entry. A job either has ALL seventeen fields (a
   *  real, complete number/election for this profile) or no key at all
   *  (this profile says nothing about that job — contributes $0, not a
   *  fallback to some other value). No partial entries — see
   *  salaryEntriesSchema in json-schemas.ts. */
  salaries: jsonb("salaries")
    .$type<
      Record<
        string,
        {
          salary: number;
          bonusPercent: number;
          bonusMultiplier: number;
          monthsInBonusYear: number;
          bonusOverride: number | null;
          payPeriod: PayPeriod;
          payWeek: PayWeek;
          anchorPayDate: string | null;
          budgetPeriodsPerMonth: number | null;
          w4FilingStatus: W4FilingStatus;
          w4Box2cChecked: boolean;
          additionalFedWithholding: number;
          bonusMonth: number | null;
          bonusDayOfMonth: number | null;
          include401kInBonus: boolean;
          includeBonusInContributions: boolean;
          extraPaycheckRouting: ExtraPaycheckRoutingData | null;
        }
      >
    >()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- State versions (full-database versioning) ---

// ────────────────────────────────────────────────────────────────────────────
// 17. State versions (backup / restore)
// ────────────────────────────────────────────────────────────────────────────

export const stateVersions = pgTable(
  "state_versions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    versionType: text("version_type").notNull(), // 'auto' | 'manual'
    schemaVersion: text("schema_version").notNull(),
    tableCount: integer("table_count").notNull(),
    totalRows: integer("total_rows").notNull(),
    sizeEstimateBytes: integer("size_estimate_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (table) => [index("state_versions_created_at_idx").on(table.createdAt)],
);

export const stateVersionTables = pgTable(
  "state_version_tables",
  {
    id: serial("id").primaryKey(),
    versionId: integer("version_id")
      .notNull()
      .references(() => stateVersions.id, { onDelete: "cascade" }),
    tableName: text("table_name").notNull(),
    rowCount: integer("row_count").notNull(),
    data: jsonb("data").$type<unknown[]>().notNull(),
  },
  (table) => [
    index("state_version_tables_version_id_idx").on(table.versionId),
    uniqueIndex("state_version_tables_version_table_idx").on(
      table.versionId,
      table.tableName,
    ),
  ],
);

// --- Change log ---

export const changeLog = pgTable(
  "change_log",
  {
    id: serial("id").primaryKey(),
    tableName: text("table_name").notNull(),
    recordId: integer("record_id").notNull(),
    fieldName: text("field_name").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    changedBy: text("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("change_log_table_record_idx").on(table.tableName, table.recordId),
    index("change_log_changed_at_idx").on(table.changedAt),
  ],
);
