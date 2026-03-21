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

// All enum-like columns are plain `text`, validated at the app layer via Zod
// against const arrays in `src/lib/config/enum-values.ts`.
// Column types are narrowed via `.$type<>()` to preserve TypeScript safety.
// This follows RULES.md principle 9 and enables cross-dialect compatibility.

import type {
  PayPeriod,
  PayWeek,
  TaxTreatment,
  MatchTaxTreatment,
  ContributionMethod,
  EmployerMatchType,
  HsaCoverageType,
  AccountOwnership,
  W4FilingStatus,
  BudgetApiService,
  ApiSyncDirection,
  PortfolioTaxType,
} from "@/lib/config/enum-values";

// --- Tables ---

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
    annualSalary: decimal("annual_salary", {
      precision: 12,
      scale: 2,
    }).notNull(),
    payPeriod: text("pay_period").$type<PayPeriod>().notNull(),
    payWeek: text("pay_week").$type<PayWeek>().notNull(),
    startDate: date("start_date").notNull(),
    anchorPayDate: date("anchor_pay_date"), // a known payday — defaults to startDate if null
    endDate: date("end_date"),
    bonusPercent: decimal("bonus_percent", { precision: 8, scale: 6 })
      .notNull()
      .default("0"),
    bonusMultiplier: decimal("bonus_multiplier", { precision: 8, scale: 6 })
      .notNull()
      .default("1.0"),
    monthsInBonusYear: integer("months_in_bonus_year").notNull().default(12),
    include401kInBonus: boolean("include_401k_in_bonus")
      .notNull()
      .default(false),
    includeBonusInContributions: boolean("include_bonus_in_contributions")
      .notNull()
      .default(true),
    bonusOverride: decimal("bonus_override", { precision: 12, scale: 2 }),
    bonusMonth: integer("bonus_month"), // 1-12, month when bonus is typically paid (null = unknown/spread)
    bonusDayOfMonth: integer("bonus_day_of_month"), // 1-31, day of month when bonus is paid (null = first period of month)
    w4FilingStatus: text("w4_filing_status").$type<W4FilingStatus>().notNull(),
    w4Box2cChecked: boolean("w4_box2c_checked").notNull().default(false),
    additionalFedWithholding: decimal("additional_fed_withholding", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    budgetPeriodsPerMonth: decimal("budget_periods_per_month", {
      precision: 6,
      scale: 4,
    }),
  },
  (table) => [index("jobs_person_id_idx").on(table.personId)],
);

export const salaryChanges = pgTable(
  "salary_changes",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    effectiveDate: date("effective_date").notNull(),
    newSalary: decimal("new_salary", { precision: 12, scale: 2 }).notNull(),
    raisePercent: decimal("raise_percent", { precision: 8, scale: 6 }),
    notes: text("notes"),
  },
  (table) => [index("salary_changes_job_id_idx").on(table.jobId)],
);

export const contributionAccounts = pgTable(
  "contribution_accounts",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    accountType: text("account_type").notNull(),
    subType: text("sub_type"),
    label: text("label"),
    parentCategory: text("parent_category").notNull().default("Retirement"),
    taxTreatment: text("tax_treatment").$type<TaxTreatment>().notNull(),
    contributionMethod: text("contribution_method").$type<ContributionMethod>().notNull(),
    contributionValue: decimal("contribution_value", {
      precision: 12,
      scale: 2,
    }).notNull(),
    employerMatchType: text("employer_match_type").$type<EmployerMatchType>().notNull(),
    employerMatchValue: decimal("employer_match_value", {
      precision: 12,
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
    ownership: text("ownership").$type<AccountOwnership>().notNull().default("individual"),
    performanceAccountId: integer("performance_account_id").references(
      () => performanceAccounts.id,
      { onDelete: "set null" },
    ),
    targetAnnual: decimal("target_annual", { precision: 12, scale: 2 }),
    allocationPriority: integer("allocation_priority").notNull().default(0),
    notes: text("notes"),
    isPayrollDeducted: boolean("is_payroll_deducted"),
  },
  (table) => [
    index("contribution_accounts_job_id_idx").on(table.jobId),
    index("contribution_accounts_person_id_idx").on(table.personId),
    index("contribution_accounts_acct_type_idx").on(table.accountType),
    index("contribution_accounts_parent_cat_idx").on(table.parentCategory),
    index("contribution_accounts_is_active_idx").on(table.isActive),
    check(
      "contribution_accounts_parent_cat_check",
      sql`parent_category IN ('Retirement', 'Portfolio')`,
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
    amountPerPeriod: decimal("amount_per_period", {
      precision: 12,
      scale: 2,
    }).notNull(),
    isPretax: boolean("is_pretax").notNull(),
    ficaExempt: boolean("fica_exempt").notNull().default(false),
  },
  (table) => [index("paycheck_deductions_job_id_idx").on(table.jobId)],
);

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
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    apiSyncDirection:
      text("api_sync_direction").$type<ApiSyncDirection>().default("pull"),
    contributionAccountId: integer("contribution_account_id").references(
      () => contributionAccounts.id,
      { onDelete: "set null" },
    ),
    isEssential: boolean("is_essential").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("budget_items_profile_id_idx").on(table.profileId),
    uniqueIndex("budget_items_profile_cat_sub_idx").on(
      table.profileId,
      table.category,
      table.subcategory,
    ),
  ],
);

export const savingsGoals = pgTable(
  "savings_goals",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    parentGoalId: integer("parent_goal_id"),
    // Self-referential FK enforced via DB migration (ALTER TABLE ADD CONSTRAINT),
    // not inline — Drizzle cannot self-reference in the same table definition.
    targetAmount: decimal("target_amount", { precision: 12, scale: 2 }),
    targetMonths: integer("target_months"),
    targetDate: date("target_date"),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    isEmergencyFund: boolean("is_emergency_fund").notNull().default(false),
    apiCategoryId: text("api_category_id"),
    apiCategoryName: text("api_category_name"),
    apiSyncEnabled: boolean("api_sync_enabled").notNull().default(false),
    reimbursementApiCategoryId: text("reimbursement_api_category_id"),
    targetMode: text("target_mode").notNull().default("fixed"), // 'fixed' | 'ongoing'
    monthlyContribution: decimal("monthly_contribution", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    allocationPercent: decimal("allocation_percent", {
      precision: 6,
      scale: 3,
    }), // % of budget leftover (e.g., 25.5 = 25.5%)
  },
  (table) => [
    index("savings_goals_is_active_idx").on(table.isActive),
    check(
      "savings_goals_target_mode_check",
      sql`target_mode IN ('fixed', 'ongoing')`,
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
    balance: decimal("balance", { precision: 12, scale: 2 }).notNull(),
    depositOrWithdrawal: decimal("deposit_or_withdrawal", {
      precision: 12,
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
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(), // positive = deposit, negative = withdrawal
    description: text("description").notNull(),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurrenceMonths: integer("recurrence_months"), // if recurring, repeat every N months
    transferPairId: text("transfer_pair_id"), // non-null + shared between two rows = a transfer pair
  },
  (table) => [index("savings_planned_tx_goal_id_idx").on(table.goalId)],
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
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [
    uniqueIndex("savings_alloc_override_goal_month_idx").on(
      table.goalId,
      table.monthDate,
    ),
  ],
);

// Brokerage (after-tax) long-term goals — planned withdrawals at a target year.
// Unlike sinking funds (cash), these are invested and subject to capital gains tax.
export const brokerageGoals = pgTable(
  "brokerage_goals",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    targetAmount: decimal("target_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    targetYear: integer("target_year").notNull(),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(), // positive = deposit, negative = withdrawal
    description: text("description").notNull(),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurrenceMonths: integer("recurrence_months"), // if recurring, repeat every N months
  },
  (table) => [index("brokerage_planned_tx_goal_id_idx").on(table.goalId)],
);

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
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    loanDate: date("loan_date").notNull(),
    repaidAmount: decimal("repaid_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    repaidDate: date("repaid_date"),
  },
  (table) => [
    index("self_loans_from_goal_id_idx").on(table.fromGoalId),
    index("self_loans_to_goal_id_idx").on(table.toGoalId),
  ],
);

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
    parentCategory: text("parent_category").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    index("performance_accounts_category_idx").on(table.parentCategory),
    index("performance_accounts_is_active_idx").on(table.isActive),
    check(
      "performance_accounts_parent_cat_check",
      sql`parent_category IN ('Retirement', 'Portfolio')`,
    ),
  ],
);

export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: serial("id").primaryKey(),
    snapshotDate: date("snapshot_date").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
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
    index("idx_portfolio_accounts_owner").on(table.ownerPersonId),
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
      precision: 12,
      scale: 2,
    }).notNull(),
    totalContributions: decimal("total_contributions", {
      precision: 12,
      scale: 2,
    }).notNull(),
    yearlyGainLoss: decimal("yearly_gain_loss", {
      precision: 12,
      scale: 2,
    }).notNull(),
    endingBalance: decimal("ending_balance", {
      precision: 12,
      scale: 2,
    }).notNull(),
    annualReturnPct: decimal("annual_return_pct", { precision: 8, scale: 6 }),
    employerContributions: decimal("employer_contributions", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    distributions: decimal("distributions", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    fees: decimal("fees", { precision: 12, scale: 2 }).notNull().default("0"),
    rollovers: decimal("rollovers", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    lifetimeGains: decimal("lifetime_gains", {
      precision: 12,
      scale: 2,
    }).notNull(),
    lifetimeContributions: decimal("lifetime_contributions", {
      precision: 12,
      scale: 2,
    }).notNull(),
    lifetimeMatch: decimal("lifetime_match", {
      precision: 12,
      scale: 2,
    }).notNull(),
    isCurrentYear: boolean("is_current_year").notNull().default(false),
    isFinalized: boolean("is_finalized").notNull().default(false),
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
      precision: 12,
      scale: 2,
    }).notNull(),
    totalContributions: decimal("total_contributions", {
      precision: 12,
      scale: 2,
    }).notNull(),
    yearlyGainLoss: decimal("yearly_gain_loss", {
      precision: 12,
      scale: 2,
    }).notNull(),
    endingBalance: decimal("ending_balance", {
      precision: 12,
      scale: 2,
    }).notNull(),
    annualReturnPct: decimal("annual_return_pct", { precision: 8, scale: 6 }),
    employerContributions: decimal("employer_contributions", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    fees: decimal("fees", { precision: 12, scale: 2 }).notNull().default("0"),
    distributions: decimal("distributions", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    rollovers: decimal("rollovers", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    parentCategory: text("parent_category").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    isFinalized: boolean("is_finalized").notNull().default(false),
    performanceAccountId: integer("performance_account_id").references(
      () => performanceAccounts.id,
      { onDelete: "restrict" },
    ),
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

export const netWorthAnnual = pgTable("net_worth_annual", {
  id: serial("id").primaryKey(),
  yearEndDate: date("year_end_date").notNull().unique(),
  grossIncome: decimal("gross_income", { precision: 12, scale: 2 }).notNull().default("0"),
  combinedAgi: decimal("combined_agi", { precision: 12, scale: 2 }).notNull().default("0"),
  ssaEarnings: decimal("ssa_earnings", { precision: 12, scale: 2 }),
  effectiveTaxRate: decimal("effective_tax_rate", { precision: 8, scale: 6 }),
  taxesPaid: decimal("taxes_paid", { precision: 12, scale: 2 }),
  // Assets
  cash: decimal("cash", { precision: 12, scale: 2 }).notNull().default("0"),
  houseValue: decimal("house_value", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  retirementTotal: decimal("retirement_total", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  hsa: decimal("hsa", { precision: 12, scale: 2 }).notNull().default("0"),
  ltBrokerage: decimal("lt_brokerage", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  espp: decimal("espp", { precision: 12, scale: 2 }).notNull().default("0"),
  rBrokerage: decimal("r_brokerage", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  otherAssets: decimal("other_assets", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  // Liabilities
  mortgageBalance: decimal("mortgage_balance", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  otherLiabilities: decimal("other_liabilities", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  // Breakdowns
  taxFreeTotal: decimal("tax_free_total", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  taxDeferredTotal: decimal("tax_deferred_total", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  portfolioTotal: decimal("portfolio_total", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  homeImprovementsCumulative: decimal("home_improvements_cumulative", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("0"),
  propertyTaxes: decimal("property_taxes", { precision: 12, scale: 2 }),
});

// Home improvement individual items — cumulative sum per year
export const homeImprovementItems = pgTable("home_improvement_items", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  description: text("description").notNull(),
  cost: decimal("cost", { precision: 12, scale: 2 }).notNull(),
  note: text("note"),
});

// Other asset items — carry-forward: latest value per name for a given year
export const otherAssetItems = pgTable(
  "other_asset_items",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    year: integer("year").notNull(),
    value: decimal("value", { precision: 12, scale: 2 }).notNull(),
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

export const mortgageLoans = pgTable(
  "mortgage_loans",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    refinancedFromId: integer("refinanced_from_id"),
    paidOffDate: date("paid_off_date"),
    principalAndInterest: decimal("principal_and_interest", {
      precision: 12,
      scale: 2,
    }).notNull(),
    pmi: decimal("pmi", { precision: 12, scale: 2 }).notNull().default("0"),
    insuranceAndTaxes: decimal("insurance_and_taxes", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    totalEscrow: decimal("total_escrow", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    interestRate: decimal("interest_rate", {
      precision: 8,
      scale: 6,
    }).notNull(),
    termYears: integer("term_years").notNull(),
    originalLoanAmount: decimal("original_loan_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    firstPaymentDate: date("first_payment_date").notNull(),
    propertyValuePurchase: decimal("property_value_purchase", {
      precision: 12,
      scale: 2,
    }).notNull(),
    propertyValueEstimated: decimal("property_value_estimated", {
      precision: 12,
      scale: 2,
    }),
    usePurchaseOrEstimated: text("use_purchase_or_estimated")
      .notNull()
      .default("purchase"),
    apiBalance: decimal("api_balance", { precision: 12, scale: 2 }),
    apiBalanceDate: date("api_balance_date"),
  },
  (table) => [index("mortgage_loans_is_active_idx").on(table.isActive)],
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
      precision: 12,
      scale: 2,
    }).notNull(),
    extraOneTimePayment: decimal("extra_one_time_payment", {
      precision: 12,
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
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
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
    assessedValue: decimal("assessed_value", { precision: 12, scale: 2 }),
    taxAmount: decimal("tax_amount", { precision: 12, scale: 2 }).notNull(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("property_taxes_loan_year_idx").on(table.loanId, table.year),
  ],
);

export const retirementSettings = pgTable(
  "retirement_settings",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" })
      .unique(),
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
    salaryCap: decimal("salary_cap", { precision: 12, scale: 2 }),
    raisesDuringRetirement: boolean("raises_during_retirement")
      .notNull()
      .default(false),
    withdrawalRate: decimal("withdrawal_rate", { precision: 8, scale: 6 })
      .notNull()
      .default("0.04"),
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
      precision: 12,
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
  },
  (table) => [index("retirement_settings_person_id_idx").on(table.personId)],
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
      precision: 12,
      scale: 2,
    }).notNull(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("retirement_salary_overrides_person_year_idx").on(
      table.personId,
      table.projectionYear,
    ),
    index("retirement_salary_overrides_person_id_idx").on(table.personId),
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
      precision: 12,
      scale: 2,
    }).notNull(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("retirement_budget_overrides_person_year_idx").on(
      table.personId,
      table.projectionYear,
    ),
    index("retirement_budget_overrides_person_id_idx").on(table.personId),
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
    precision: 12,
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
  ltBrokerageEnabled: boolean("lt_brokerage_enabled").notNull().default(true),
  ltBrokerageAnnualContribution: decimal("lt_brokerage_annual_contribution", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("0"),
  isSelected: boolean("is_selected").notNull().default(false),
  notes: text("notes"),
});

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

export type ApiConfig = Record<string, string | undefined>;

export type AccountMapping = {
  localId?: string; // "performance:{id}" | "asset:{id}" | "mortgage:{loanId}:{type}" (legacy prefix format)
  localName: string; // Cached display name (UI only, not for resolution)
  remoteAccountId: string;
  syncDirection: "pull" | "push" | "both";
  // Typed ID fields — preferred over parsing localId prefix strings
  assetId?: number; // Direct reference to otherAssetItems.id
  loanId?: number; // Direct reference to mortgageLoans.id
  loanMapType?: "propertyValue" | "loanBalance"; // What the mortgage mapping controls
  performanceAccountId?: number; // Direct reference to performanceAccounts.id
};

export const apiConnections = pgTable("api_connections", {
  id: serial("id").primaryKey(),
  service: text("service").notNull().unique(),
  config: jsonb("config").$type<ApiConfig>().notNull(),
  accountMappings: jsonb("account_mappings").$type<AccountMapping[]>(),
  skippedCategoryIds: jsonb("skipped_category_ids").$type<string[]>(),
  linkedProfileId: integer("linked_profile_id"),
  linkedColumnIndex: integer("linked_column_index"),
  serverKnowledge: integer("server_knowledge"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

export const budgetApiCache = pgTable(
  "budget_api_cache",
  {
    id: serial("id").primaryKey(),
    service: text("service").$type<BudgetApiService>().notNull(),
    cacheKey: text("cache_key").notNull(),
    data: jsonb("data").$type<unknown>().notNull(),
    serverKnowledge: integer("server_knowledge"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("budget_api_cache_service_key_idx").on(
      table.service,
      table.cacheKey,
    ),
  ],
);

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
};

export const relocationScenarios = pgTable("relocation_scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  params: jsonb("params").$type<RelocationScenarioParams>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Scenario overrides (global what-if system) ---

/** Nested override map: { entityType: { recordId: { field: value } } } */
export type ScenarioOverrides = Record<
  string,
  Record<string, Record<string, unknown>>
>;

export const scenarios = pgTable("scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  overrides: jsonb("overrides")
    .$type<ScenarioOverrides>()
    .notNull()
    .default({}),
  isBaseline: boolean("is_baseline").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Monte Carlo: Asset class parameters and glide path ---

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
  ],
);

// --- Contribution profiles (what-if salary/contribution overrides) ---

export const contributionProfiles = pgTable("contribution_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  salaryOverrides: jsonb("salary_overrides")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  contributionOverrides: jsonb("contribution_overrides")
    .$type<ScenarioOverrides>()
    .notNull()
    .default({}),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- State versions (full-database versioning) ---

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("change_log_table_record_idx").on(table.tableName, table.recordId),
    index("change_log_changed_at_idx").on(table.changedAt),
  ],
);
