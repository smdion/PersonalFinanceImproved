// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { decimalText } from "../sqlite-decimal";

import type { BudgetApiService } from "@/lib/config/budget-apps";
import { budgetProfiles } from "./budget";
import { jobs } from "./people";

// ────────────────────────────────────────────────────────────────────────────
// 4. Savings (sinking funds)
// ────────────────────────────────────────────────────────────────────────────

export const savingsGoals = sqliteTable(
  "savings_goals",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    // Some SQLite installs lack this FK (SQLite can't add one in place), so deleting
    // a goal also detaches its sub-goals in app code (deleteSavingsGoal).
    parentGoalId: integer("parent_goal_id").references(
      (): AnySQLiteColumn => savingsGoals.id,
      { onDelete: "set null" },
    ),
    targetAmount: decimalText("target_amount"),
    targetMonths: integer("target_months"),
    targetDate: text("target_date"),
    priority: integer("priority").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isEmergencyFund: integer("is_emergency_fund", { mode: "boolean" })
      .notNull()
      .default(false),
    apiCategoryId: text("api_category_id"),
    apiCategoryName: text("api_category_name"),
    isApiSyncEnabled: integer("is_api_sync_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
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
export const savingsGoalCategoryLinks = sqliteTable(
  "savings_goal_category_links",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    savingsGoalId: integer("savings_goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    service: text("service").notNull().$type<BudgetApiService>(),
    role: text("role").notNull().default("primary"), // 'primary' | 'reimbursement'
    categoryId: text("category_id").notNull(),
    categoryName: text("category_name"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
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

export const savingsMonthly = sqliteTable(
  "savings_monthly",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    goalId: integer("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    monthDate: text("month_date").notNull(),
    balance: decimalText("balance").notNull(),
    depositOrWithdrawal: decimalText("deposit_or_withdrawal"),
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
    amount: decimalText("amount").notNull(), // positive = deposit, negative = withdrawal
    description: text("description").notNull(),
    isRecurring: integer("is_recurring", { mode: "boolean" })
      .notNull()
      .default(false),
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
export const savingsPlannedTxSettlements = sqliteTable(
  "savings_planned_tx_settlements",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    plannedTxId: integer("planned_tx_id")
      .notNull()
      .references(() => savingsPlannedTransactions.id, {
        onDelete: "cascade",
      }),
    occurrenceMonth: text("occurrence_month").notNull(), // always the 1st of the settled occurrence's month
    settledAt: integer("settled_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
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
export const savingsAllocationOverrides = sqliteTable(
  "savings_allocation_overrides",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    goalId: integer("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    monthDate: text("month_date").notNull(),
    amount: decimalText("amount").notNull(),
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
export const budgetIncomeAdjustments = sqliteTable(
  "budget_income_adjustments",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    monthDate: text("month_date").notNull(), // "YYYY-MM-01"
    amount: decimalText("amount").notNull(),
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
export const savingsGoalProfileAllocations = sqliteTable(
  "savings_goal_profile_allocations",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    goalId: integer("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    budgetProfileId: integer("budget_profile_id")
      .notNull()
      .references(() => budgetProfiles.id, { onDelete: "cascade" }),
    allocationPercent: decimalText("allocation_percent"),
    monthlyContribution: decimalText("monthly_contribution").notNull(),
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
