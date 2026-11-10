// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  date,
  timestamp,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { decimal } from "../pg-decimal";
import type { BudgetApiService } from "@/lib/config/budget-apps";
import { budgetProfiles } from "./budget";
import { jobs } from "./people";

// ────────────────────────────────────────────────────────────────────────────
// 4. Savings (sinking funds)
// ────────────────────────────────────────────────────────────────────────────

export const savingsGoals = pgTable(
  "savings_goals",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    // Some SQLite installs lack this FK (SQLite can't add one in place), so deleting
    // a goal also detaches its sub-goals in app code (deleteSavingsGoal).
    parentGoalId: integer("parent_goal_id").references(
      (): AnyPgColumn => savingsGoals.id,
      { onDelete: "set null" },
    ),
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
  (table) => [
    index("savings_goals_is_active_idx").on(table.isActive),
    index("savings_goals_parent_goal_id_idx").on(table.parentGoalId),
  ],
);

// One row per (savings goal, service, role), so a goal can link to several services.
// savingsGoals' single-slot api* columns are unused, kept until a schema squash.
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

// Settlement is per occurrence, not on the row: a recurring row stands for many
// occurrences (a non-recurring row has one, its transactionDate's month).
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

// Extra-paycheck amounts for jobs routed in Budget mode, one row per (job, month); Savings
// mode writes savings_planned_transactions instead (extra-paycheck-materializer.ts).
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

// Per-(goal, budget profile) funding (amount, percent vs flat): every active pair has a row,
// seeded at $0 when a goal or profile is created, with no shared default. Goal identity
// (name, target, priority) stays on savingsGoals, shared across profiles.
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
