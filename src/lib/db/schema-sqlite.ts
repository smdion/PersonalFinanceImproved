// AUTO-GENERATED from schema-pg.ts — do not edit by hand.
// Run: npx tsx scripts/gen-sqlite-schema.ts
// SQLite dialect of the Drizzle schema.

import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/sqlite-core";
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

export const people = sqliteTable("people", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  dateOfBirth: text("date_of_birth").notNull(),
  isPrimaryUser: integer("is_primary_user", { mode: "boolean" }).notNull().default(false),
});

export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    employerName: text("employer_name").notNull(),
    title: text("title"),
    annualSalary: text("annual_salary").notNull(),
    payPeriod: text("pay_period").$type<PayPeriod>().notNull(),
    payWeek: text("pay_week").$type<PayWeek>().notNull(),
    startDate: text("start_date").notNull(),
    anchorPayDate: text("anchor_pay_date"), // a known payday — defaults to startDate if null
    endDate: text("end_date"),
    bonusPercent: text("bonus_percent")
      .notNull()
      .default("0"),
    bonusMultiplier: text("bonus_multiplier")
      .notNull()
      .default("1.0"),
    monthsInBonusYear: integer("months_in_bonus_year").notNull().default(12),
    include401kInBonus: integer("include_401k_in_bonus", { mode: "boolean" })
      .notNull()
      .default(false),
    includeBonusInContributions: integer("include_bonus_in_contributions", { mode: "boolean" })
      .notNull()
      .default(true),
    bonusOverride: text("bonus_override"),
    bonusMonth: integer("bonus_month"), // 1-12, month when bonus is typically paid (null = unknown/spread)
    bonusDayOfMonth: integer("bonus_day_of_month"), // 1-31, day of month when bonus is paid (null = first period of month)
    w4FilingStatus: text("w4_filing_status").$type<W4FilingStatus>().notNull(),
    w4Box2cChecked: integer("w4_box2c_checked", { mode: "boolean" }).notNull().default(false),
    additionalFedWithholding: text("additional_fed_withholding")
      .notNull()
      .default("0"),
    budgetPeriodsPerMonth: text("budget_periods_per_month"),
  },
  (table) => [index("jobs_person_id_idx").on(table.personId)],
);

export const salaryChanges = sqliteTable(
  "salary_changes",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    effectiveDate: text("effective_date").notNull(),
    newSalary: text("new_salary").notNull(),
    raisePercent: text("raise_percent"),
    notes: text("notes"),
  },
  (table) => [index("salary_changes_job_id_idx").on(table.jobId)],
);

export const contributionAccounts = sqliteTable(
  "contribution_accounts",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
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
    contributionValue: text("contribution_value").notNull(),
    employerMatchType: text("employer_match_type").$type<EmployerMatchType>().notNull(),
    employerMatchValue: text("employer_match_value"),
    employerMaxMatchPct: text("employer_max_match_pct"),
    employerMatchTaxTreatment: text("employer_match_tax_treatment")
      .$type<MatchTaxTreatment>()
      .notNull()
      .default("pre_tax"),
    hsaCoverageType: text("hsa_coverage_type").$type<HsaCoverageType>(),
    autoMaximize: integer("auto_maximize", { mode: "boolean" }).notNull().default(false),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ownership: text("ownership").$type<AccountOwnership>().notNull().default("individual"),
    performanceAccountId: integer("performance_account_id").references(
      () => performanceAccounts.id,
      { onDelete: "set null" },
    ),
    targetAnnual: text("target_annual"),
    allocationPriority: integer("allocation_priority").notNull().default(0),
    notes: text("notes"),
    isPayrollDeducted: integer("is_payroll_deducted", { mode: "boolean" }),
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

export const contributionLimits = sqliteTable(
  "contribution_limits",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    taxYear: integer("tax_year").notNull(),
    limitType: text("limit_type").notNull(),
    value: text("value").notNull(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("contribution_limits_year_type_idx").on(
      table.taxYear,
      table.limitType,
    ),
  ],
);

export const paycheckDeductions = sqliteTable(
  "paycheck_deductions",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    deductionName: text("deduction_name").notNull(),
    amountPerPeriod: text("amount_per_period").notNull(),
    isPretax: integer("is_pretax", { mode: "boolean" }).notNull(),
    ficaExempt: integer("fica_exempt", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [index("paycheck_deductions_job_id_idx").on(table.jobId)],
);

export const budgetProfiles = sqliteTable(
  "budget_profiles",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    description: text("description"),
    columnLabels: text("column_labels", { mode: "json" }).$type<string[]>().notNull(),
    columnMonths: text("column_months", { mode: "json" }).$type<number[]>(),
    columnContributionProfileIds: text(
      "column_contribution_profile_ids", { mode: "json" },
    ).$type<(number | null)[]>(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [index("budget_profiles_is_active_idx").on(table.isActive)],
);

export const budgetItems = sqliteTable(
  "budget_items",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    profileId: integer("profile_id")
      .notNull()
      .references(() => budgetProfiles.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    amounts: text("amounts", { mode: "json" }).$type<number[]>().notNull(),
    apiCategoryName: text("api_category_name"),
    apiCategoryId: text("api_category_id"),
    apiLastSyncedAt: integer("api_last_synced_at", { mode: "timestamp" }),
    apiSyncDirection:
      text("api_sync_direction").$type<ApiSyncDirection>().default("pull"),
    contributionAccountId: integer("contribution_account_id").references(
      () => contributionAccounts.id,
      { onDelete: "set null" },
    ),
    isEssential: integer("is_essential", { mode: "boolean" }).notNull().default(true),
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

export const savingsGoals = sqliteTable(
  "savings_goals",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    parentGoalId: integer("parent_goal_id"),
    // Self-referential FK enforced via DB migration (ALTER TABLE ADD CONSTRAINT),
    // not inline — Drizzle cannot self-reference in the same table definition.
    targetAmount: text("target_amount"),
    targetMonths: integer("target_months"),
    targetDate: text("target_date"),
    priority: integer("priority").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isEmergencyFund: integer("is_emergency_fund", { mode: "boolean" }).notNull().default(false),
    apiCategoryId: text("api_category_id"),
    apiCategoryName: text("api_category_name"),
    apiSyncEnabled: integer("api_sync_enabled", { mode: "boolean" }).notNull().default(false),
    reimbursementApiCategoryId: text("reimbursement_api_category_id"),
    targetMode: text("target_mode").notNull().default("fixed"), // 'fixed' | 'ongoing'
    monthlyContribution: text("monthly_contribution")
      .notNull()
      .default("0"),
    allocationPercent: text("allocation_percent"), // % of budget leftover (e.g., 25.5 = 25.5%)
  },
  (table) => [
    index("savings_goals_is_active_idx").on(table.isActive),
    check(
      "savings_goals_target_mode_check",
      sql`target_mode IN ('fixed', 'ongoing')`,
    ),
  ],
);

export const savingsMonthly = sqliteTable(
  "savings_monthly",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    goalId: integer("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    monthDate: text("month_date").notNull(),
    balance: text("balance").notNull(),
    depositOrWithdrawal: text("deposit_or_withdrawal"),
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

export const savingsPlannedTransactions = sqliteTable(
  "savings_planned_transactions",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    goalId: integer("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    transactionDate: text("transaction_date").notNull(),
    amount: text("amount").notNull(), // positive = deposit, negative = withdrawal
    description: text("description").notNull(),
    isRecurring: integer("is_recurring", { mode: "boolean" }).notNull().default(false),
    recurrenceMonths: integer("recurrence_months"), // if recurring, repeat every N months
    transferPairId: text("transfer_pair_id"), // non-null + shared between two rows = a transfer pair
  },
  (table) => [index("savings_planned_tx_goal_id_idx").on(table.goalId)],
);

// Per-month allocation overrides for sinking fund projections.
// When set, overrides the default monthly contribution for a goal in that month.
export const savingsAllocationOverrides = sqliteTable(
  "savings_allocation_overrides",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    goalId: integer("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    monthDate: text("month_date").notNull(),
    amount: text("amount").notNull(),
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
export const brokerageGoals = sqliteTable(
  "brokerage_goals",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    targetAmount: text("target_amount").notNull(),
    targetYear: integer("target_year").notNull(),
    priority: integer("priority").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [index("brokerage_goals_is_active_idx").on(table.isActive)],
);

export const brokeragePlannedTransactions = sqliteTable(
  "brokerage_planned_transactions",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    goalId: integer("goal_id")
      .notNull()
      .references(() => brokerageGoals.id, { onDelete: "cascade" }),
    transactionDate: text("transaction_date").notNull(),
    amount: text("amount").notNull(), // positive = deposit, negative = withdrawal
    description: text("description").notNull(),
    isRecurring: integer("is_recurring", { mode: "boolean" }).notNull().default(false),
    recurrenceMonths: integer("recurrence_months"), // if recurring, repeat every N months
  },
  (table) => [index("brokerage_planned_tx_goal_id_idx").on(table.goalId)],
);

export const selfLoans = sqliteTable(
  "self_loans",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    fromGoalId: integer("from_goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "restrict" }),
    toGoalId: integer("to_goal_id").references(() => savingsGoals.id, {
      onDelete: "restrict",
    }),
    amount: text("amount").notNull(),
    loanDate: text("loan_date").notNull(),
    repaidAmount: text("repaid_amount")
      .notNull()
      .default("0"),
    repaidDate: text("repaid_date"),
  },
  (table) => [
    index("self_loans_from_goal_id_idx").on(table.fromGoalId),
    index("self_loans_to_goal_id_idx").on(table.toGoalId),
  ],
);

export const performanceAccounts = sqliteTable(
  "performance_accounts",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
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
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
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

export const portfolioSnapshots = sqliteTable(
  "portfolio_snapshots",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    snapshotDate: text("snapshot_date").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    notes: text("notes"),
  },
  (table) => [index("portfolio_snapshots_date_idx").on(table.snapshotDate)],
);

export const portfolioAccounts = sqliteTable(
  "portfolio_accounts",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => portfolioSnapshots.id, { onDelete: "cascade" }),
    institution: text("institution").notNull(),
    taxType: text("tax_type").$type<PortfolioTaxType>().notNull(),
    amount: text("amount").notNull(),
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
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
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

export const annualPerformance = sqliteTable(
  "annual_performance",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    year: integer("year").notNull(),
    category: text("category").notNull(),
    beginningBalance: text("beginning_balance").notNull(),
    totalContributions: text("total_contributions").notNull(),
    yearlyGainLoss: text("yearly_gain_loss").notNull(),
    endingBalance: text("ending_balance").notNull(),
    annualReturnPct: text("annual_return_pct"),
    employerContributions: text("employer_contributions")
      .notNull()
      .default("0"),
    distributions: text("distributions")
      .notNull()
      .default("0"),
    fees: text("fees").notNull().default("0"),
    rollovers: text("rollovers").notNull().default("0"),
    lifetimeGains: text("lifetime_gains").notNull(),
    lifetimeContributions: text("lifetime_contributions").notNull(),
    lifetimeMatch: text("lifetime_match").notNull(),
    isCurrentYear: integer("is_current_year", { mode: "boolean" }).notNull().default(false),
    isFinalized: integer("is_finalized", { mode: "boolean" }).notNull().default(false),
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

export const accountPerformance = sqliteTable(
  "account_performance",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    year: integer("year").notNull(),
    institution: text("institution").notNull(),
    accountLabel: text("account_label").notNull(),
    ownerPersonId: integer("owner_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    beginningBalance: text("beginning_balance").notNull(),
    totalContributions: text("total_contributions").notNull(),
    yearlyGainLoss: text("yearly_gain_loss").notNull(),
    endingBalance: text("ending_balance").notNull(),
    annualReturnPct: text("annual_return_pct"),
    employerContributions: text("employer_contributions")
      .notNull()
      .default("0"),
    fees: text("fees").notNull().default("0"),
    distributions: text("distributions")
      .notNull()
      .default("0"),
    rollovers: text("rollovers").notNull().default("0"),
    parentCategory: text("parent_category").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isFinalized: integer("is_finalized", { mode: "boolean" }).notNull().default(false),
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

export const netWorthAnnual = sqliteTable("net_worth_annual", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  yearEndDate: text("year_end_date").notNull().unique(),
  grossIncome: text("gross_income").notNull().default("0"),
  combinedAgi: text("combined_agi").notNull().default("0"),
  ssaEarnings: text("ssa_earnings"),
  effectiveTaxRate: text("effective_tax_rate"),
  taxesPaid: text("taxes_paid"),
  // Assets
  cash: text("cash").notNull().default("0"),
  houseValue: text("house_value")
    .notNull()
    .default("0"),
  retirementTotal: text("retirement_total")
    .notNull()
    .default("0"),
  hsa: text("hsa").notNull().default("0"),
  ltBrokerage: text("lt_brokerage")
    .notNull()
    .default("0"),
  espp: text("espp").notNull().default("0"),
  rBrokerage: text("r_brokerage")
    .notNull()
    .default("0"),
  otherAssets: text("other_assets")
    .notNull()
    .default("0"),
  // Liabilities
  mortgageBalance: text("mortgage_balance")
    .notNull()
    .default("0"),
  otherLiabilities: text("other_liabilities")
    .notNull()
    .default("0"),
  // Breakdowns
  taxFreeTotal: text("tax_free_total")
    .notNull()
    .default("0"),
  taxDeferredTotal: text("tax_deferred_total")
    .notNull()
    .default("0"),
  portfolioTotal: text("portfolio_total")
    .notNull()
    .default("0"),
  homeImprovementsCumulative: text("home_improvements_cumulative")
    .notNull()
    .default("0"),
  propertyTaxes: text("property_taxes"),
});

// Home improvement individual items — cumulative sum per year
export const homeImprovementItems = sqliteTable("home_improvement_items", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  year: integer("year").notNull(),
  description: text("description").notNull(),
  cost: text("cost").notNull(),
  note: text("note"),
});

// Other asset items — carry-forward: latest value per name for a given year
export const otherAssetItems = sqliteTable(
  "other_asset_items",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    year: integer("year").notNull(),
    value: text("value").notNull(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("other_asset_items_name_year_idx").on(table.name, table.year),
  ],
);

// Notes on any historical table cell
export const historicalNotes = sqliteTable(
  "historical_notes",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    year: integer("year").notNull(),
    field: text("field").notNull(),
    note: text("note").notNull(),
  },
  (table) => [
    uniqueIndex("historical_notes_year_field_idx").on(table.year, table.field),
  ],
);

export const mortgageLoans = sqliteTable(
  "mortgage_loans",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
    refinancedFromId: integer("refinanced_from_id"),
    paidOffDate: text("paid_off_date"),
    principalAndInterest: text("principal_and_interest").notNull(),
    pmi: text("pmi").notNull().default("0"),
    insuranceAndTaxes: text("insurance_and_taxes")
      .notNull()
      .default("0"),
    totalEscrow: text("total_escrow")
      .notNull()
      .default("0"),
    interestRate: text("interest_rate").notNull(),
    termYears: integer("term_years").notNull(),
    originalLoanAmount: text("original_loan_amount").notNull(),
    firstPaymentDate: text("first_payment_date").notNull(),
    propertyValuePurchase: text("property_value_purchase").notNull(),
    propertyValueEstimated: text("property_value_estimated"),
    usePurchaseOrEstimated: text("use_purchase_or_estimated")
      .notNull()
      .default("purchase"),
    apiBalance: text("api_balance"),
    apiBalanceDate: text("api_balance_date"),
  },
  (table) => [index("mortgage_loans_is_active_idx").on(table.isActive)],
);

export const mortgageWhatIfScenarios = sqliteTable(
  "mortgage_what_if_scenarios",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id").references(() => mortgageLoans.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    extraMonthlyPrincipal: text("extra_monthly_principal").notNull(),
    extraOneTimePayment: text("extra_one_time_payment")
      .notNull()
      .default("0"),
    refinanceRate: text("refinance_rate"),
    refinanceTerm: integer("refinance_term"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("mortgage_what_if_loan_id_idx").on(table.loanId)],
);

export const mortgageExtraPayments = sqliteTable(
  "mortgage_extra_payments",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id")
      .notNull()
      .references(() => mortgageLoans.id, { onDelete: "cascade" }),
    paymentDate: text("payment_date"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    amount: text("amount").notNull(),
    isActual: integer("is_actual", { mode: "boolean" }).notNull().default(false),
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

export const propertyTaxes = sqliteTable(
  "property_taxes",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id")
      .notNull()
      .references(() => mortgageLoans.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    assessedValue: text("assessed_value"),
    taxAmount: text("tax_amount").notNull(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("property_taxes_loan_year_idx").on(table.loanId, table.year),
  ],
);

export const retirementSettings = sqliteTable(
  "retirement_settings",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" })
      .unique(),
    retirementAge: integer("retirement_age").notNull(),
    endAge: integer("end_age").notNull(),
    returnAfterRetirement: text("return_after_retirement").notNull(),
    annualInflation: text("annual_inflation").notNull(),
    postRetirementInflation: text("post_retirement_inflation"),
    salaryAnnualIncrease: text("salary_annual_increase").notNull(),
    salaryCap: text("salary_cap"),
    raisesDuringRetirement: integer("raises_during_retirement", { mode: "boolean" })
      .notNull()
      .default(false),
    withdrawalRate: text("withdrawal_rate")
      .notNull()
      .default("0.04"),
    taxMultiplier: text("tax_multiplier")
      .notNull()
      .default("1.0"),
    grossUpForTaxes: integer("gross_up_for_taxes", { mode: "boolean" }).notNull().default(true),
    /** Target marginal rate for Roth optimization (e.g. 0.12 = stay in 12% bracket). Null = disabled. */
    rothBracketTarget: text("roth_bracket_target").default("0.12"),
    /** Monthly Social Security benefit estimate in today's dollars. */
    socialSecurityMonthly: text("social_security_monthly")
      .notNull()
      .default("2500"),
    /** Age at which Social Security income begins. */
    ssStartAge: integer("ss_start_age").notNull().default(67),
    /** Enable automatic Roth conversions during decumulation (fills target bracket). */
    enableRothConversions: integer("enable_roth_conversions", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Target marginal rate for Roth conversions (null = inherit from rothBracketTarget). */
    rothConversionTarget: text("roth_conversion_target"),
    /** Withdrawal/spending strategy (see withdrawal-strategies.ts registry). */
    withdrawalStrategy: text("withdrawal_strategy")
      .notNull()
      .default("fixed"),
    /** G-K: upper guardrail — if currentRate < initialRate × this, increase spending (e.g. 0.80). */
    gkUpperGuardrail: text("gk_upper_guardrail").default("0.80"),
    /** G-K: lower guardrail — if currentRate > initialRate × this, decrease spending (e.g. 1.20). */
    gkLowerGuardrail: text("gk_lower_guardrail").default("1.20"),
    /** G-K: spending increase percentage when upper guardrail triggers (e.g. 0.10 = 10%). */
    gkIncreasePct: text("gk_increase_pct").default("0.10"),
    /** G-K: spending decrease percentage when lower guardrail triggers (e.g. 0.10 = 10%). */
    gkDecreasePct: text("gk_decrease_pct").default("0.10"),
    /** G-K: skip inflation adjustment in years following a portfolio loss. */
    gkSkipInflationAfterLoss: integer("gk_skip_inflation_after_loss", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Spending Decline: annual real decline rate (e.g. 0.02 = 2%). */
    sdAnnualDeclineRate: text("sd_annual_decline_rate").default("0.02"),
    /** Constant Percentage: withdrawal % of current balance. */
    cpWithdrawalPercent: text("cp_withdrawal_percent").default("0.05"),
    /** Constant Percentage: floor as % of initial withdrawal. */
    cpFloorPercent: text("cp_floor_percent").default("0.90"),
    /** Endowment: withdrawal % of rolling average balance. */
    enWithdrawalPercent: text("en_withdrawal_percent").default("0.05"),
    /** Endowment: rolling window in years. */
    enRollingYears: integer("en_rolling_years").default(10),
    /** Endowment: floor as % of initial withdrawal. */
    enFloorPercent: text("en_floor_percent").default("0.90"),
    /** Vanguard Dynamic: base withdrawal %. */
    vdBasePercent: text("vd_base_percent").default("0.05"),
    /** Vanguard Dynamic: max YoY spending increase. */
    vdCeilingPercent: text("vd_ceiling_percent").default("0.05"),
    /** Vanguard Dynamic: max YoY spending decrease. */
    vdFloorPercent: text("vd_floor_percent").default("0.025"),
    /** RMD Spending: multiplier on IRS RMD amount. */
    rmdMultiplier: text("rmd_multiplier").default("1.0"),
    /** Enable IRMAA awareness — constrain Roth conversions/withdrawals near Medicare surcharge cliffs (65+). */
    enableIrmaaAwareness: integer("enable_irmaa_awareness", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Enable ACA subsidy awareness — cap MAGI to preserve health insurance subsidies (pre-65). */
    enableAcaAwareness: integer("enable_aca_awareness", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Household size for ACA FPL calculation. */
    householdSize: integer("household_size").notNull().default(2),
  },
  (table) => [index("retirement_settings_person_id_idx").on(table.personId)],
);

export const retirementSalaryOverrides = sqliteTable(
  "retirement_salary_overrides",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    projectionYear: integer("projection_year").notNull(),
    overrideSalary: text("override_salary").notNull(),
    contributionProfileId: integer("contribution_profile_id").references(
      () => contributionProfiles.id,
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
  ],
);

export const retirementBudgetOverrides = sqliteTable(
  "retirement_budget_overrides",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    projectionYear: integer("projection_year").notNull(),
    overrideMonthlyBudget: text("override_monthly_budget").notNull(),
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

export const retirementScenarios = sqliteTable("retirement_scenarios", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  withdrawalRate: text("withdrawal_rate").notNull(),
  targetAnnualIncome: text("target_annual_income").notNull(),
  annualInflation: text("annual_inflation").notNull(),
  distributionTaxRateTraditional: text("distribution_tax_rate_traditional")
    .notNull()
    .default("0.22"),
  distributionTaxRateRoth: text("distribution_tax_rate_roth")
    .notNull()
    .default("0"),
  distributionTaxRateHsa: text("distribution_tax_rate_hsa")
    .notNull()
    .default("0"),
  distributionTaxRateBrokerage: text("distribution_tax_rate_brokerage")
    .notNull()
    .default("0.15"),
  ltBrokerageEnabled: integer("lt_brokerage_enabled", { mode: "boolean" }).notNull().default(true),
  ltBrokerageAnnualContribution: text("lt_brokerage_annual_contribution")
    .notNull()
    .default("0"),
  isSelected: integer("is_selected", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
});

export const returnRateTable = sqliteTable("return_rate_table", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  age: integer("age").notNull().unique(),
  rateOfReturn: text("rate_of_return").notNull(),
});

export type TaxBracketEntry = {
  threshold: number;
  baseWithholding: number;
  rate: number;
};

export const taxBrackets = sqliteTable(
  "tax_brackets",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    w4Checkbox: integer("w4_checkbox", { mode: "boolean" }).notNull(),
    brackets: text("brackets", { mode: "json" }).$type<TaxBracketEntry[]>().notNull(),
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
  threshold: number; // Infinity stored as null in JSON
  rate: number;
};

export const ltcgBrackets = sqliteTable(
  "ltcg_brackets",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    brackets: text("brackets", { mode: "json" }).$type<LtcgBracketEntry[]>().notNull(),
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

export const irmaaBrackets = sqliteTable(
  "irmaa_brackets",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    brackets: text("brackets", { mode: "json" }).$type<IrmaaBracketEntry[]>().notNull(),
  },
  (table) => [
    uniqueIndex("irmaa_brackets_year_status_idx").on(
      table.taxYear,
      table.filingStatus,
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

export const apiConnections = sqliteTable("api_connections", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  service: text("service").notNull().unique(),
  config: text("config", { mode: "json" }).$type<ApiConfig>().notNull(),
  accountMappings: text("account_mappings", { mode: "json" }).$type<AccountMapping[]>(),
  skippedCategoryIds: text("skipped_category_ids", { mode: "json" }).$type<string[]>(),
  linkedProfileId: integer("linked_profile_id"),
  linkedColumnIndex: integer("linked_column_index"),
  serverKnowledge: integer("server_knowledge"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
});

export const budgetApiCache = sqliteTable(
  "budget_api_cache",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    service: text("service").$type<BudgetApiService>().notNull(),
    cacheKey: text("cache_key").notNull(),
    data: text("data", { mode: "json" }).$type<unknown>().notNull(),
    serverKnowledge: integer("server_knowledge"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("budget_api_cache_service_key_idx").on(
      table.service,
      table.cacheKey,
    ),
  ],
);

export const appSettings = sqliteTable("app_settings", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
});

// --- Local admin accounts ---

export const localAdmins = sqliteTable("local_admins", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
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

export const relocationScenarios = sqliteTable("relocation_scenarios", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  params: text("params", { mode: "json" }).$type<RelocationScenarioParams>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// --- Scenario overrides (global what-if system) ---

/** Nested override map: { entityType: { recordId: { field: value } } } */
export type ScenarioOverrides = Record<
  string,
  Record<string, Record<string, unknown>>
>;

export const scenarios = sqliteTable("scenarios", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  overrides: text("overrides", { mode: "json" })
    .$type<ScenarioOverrides>()
    .notNull()
    .default(sql`'{}'`),
  isBaseline: integer("is_baseline", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// --- Monte Carlo: Asset class parameters and glide path ---

export const assetClassParams = sqliteTable(
  "asset_class_params",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    meanReturn: text("mean_return").notNull(),
    stdDev: text("std_dev").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [index("asset_class_params_is_active_idx").on(table.isActive)],
);

export const assetClassCorrelations = sqliteTable(
  "asset_class_correlations",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    classAId: integer("class_a_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    classBId: integer("class_b_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    correlation: text("correlation").notNull(),
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

export const glidePathAllocations = sqliteTable(
  "glide_path_allocations",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    age: integer("age").notNull(),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    allocation: text("allocation").notNull(),
  },
  (table) => [
    uniqueIndex("glide_path_age_class_idx").on(table.age, table.assetClassId),
    index("glide_path_asset_class_idx").on(table.assetClassId),
  ],
);

// --- Monte Carlo: Presets (DB-driven, replaces hardcoded MC_PRESETS) ---

export const mcPresets = sqliteTable(
  "mc_presets",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(), // 'aggressive', 'default', 'conservative'
    label: text("label").notNull(),
    description: text("description").notNull(),
    returnMultiplier: text("return_multiplier")
      .notNull()
      .default("1.000000"),
    volMultiplier: text("vol_multiplier")
      .notNull()
      .default("1.000000"),
    inflationMean: text("inflation_mean")
      .notNull()
      .default("0.025000"),
    inflationStdDev: text("inflation_std_dev")
      .notNull()
      .default("0.012000"),
    defaultTrials: integer("default_trials").notNull().default(5000),
    returnClampMin: text("return_clamp_min")
      .notNull()
      .default("-0.500000"),
    returnClampMax: text("return_clamp_max")
      .notNull()
      .default("1.000000"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [index("mc_presets_is_active_idx").on(table.isActive)],
);

export const mcPresetGlidePaths = sqliteTable(
  "mc_preset_glide_paths",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    presetId: integer("preset_id")
      .notNull()
      .references(() => mcPresets.id, { onDelete: "cascade" }),
    age: integer("age").notNull(),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    allocation: text("allocation").notNull(),
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

export const mcPresetReturnOverrides = sqliteTable(
  "mc_preset_return_overrides",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    presetId: integer("preset_id")
      .notNull()
      .references(() => mcPresets.id, { onDelete: "cascade" }),
    assetClassId: integer("asset_class_id")
      .notNull()
      .references(() => assetClassParams.id, { onDelete: "cascade" }),
    meanReturn: text("mean_return").notNull(),
  },
  (table) => [
    uniqueIndex("mc_preset_ro_idx").on(table.presetId, table.assetClassId),
  ],
);

// --- Contribution profiles (what-if salary/contribution overrides) ---

export const contributionProfiles = sqliteTable("contribution_profiles", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  salaryOverrides: text("salary_overrides", { mode: "json" })
    .$type<Record<string, number>>()
    .notNull()
    .default(sql`'{}'`),
  contributionOverrides: text("contribution_overrides", { mode: "json" })
    .$type<ScenarioOverrides>()
    .notNull()
    .default(sql`'{}'`),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// --- State versions (full-database versioning) ---

export const stateVersions = sqliteTable(
  "state_versions",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    versionType: text("version_type").notNull(), // 'auto' | 'manual'
    schemaVersion: text("schema_version").notNull(),
    tableCount: integer("table_count").notNull(),
    totalRows: integer("total_rows").notNull(),
    sizeEstimateBytes: integer("size_estimate_bytes"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    createdBy: text("created_by").notNull(),
  },
  (table) => [index("state_versions_created_at_idx").on(table.createdAt)],
);

export const stateVersionTables = sqliteTable(
  "state_version_tables",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    versionId: integer("version_id")
      .notNull()
      .references(() => stateVersions.id, { onDelete: "cascade" }),
    tableName: text("table_name").notNull(),
    rowCount: integer("row_count").notNull(),
    data: text("data", { mode: "json" }).$type<unknown[]>().notNull(),
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

export const changeLog = sqliteTable(
  "change_log",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    tableName: text("table_name").notNull(),
    recordId: integer("record_id").notNull(),
    fieldName: text("field_name").notNull(),
    oldValue: text("old_value", { mode: "json" }),
    newValue: text("new_value", { mode: "json" }),
    changedBy: text("changed_by").notNull(),
    changedAt: integer("changed_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    index("change_log_table_record_idx").on(table.tableName, table.recordId),
    index("change_log_changed_at_idx").on(table.changedAt),
  ],
);
