// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  date,
  timestamp,
  decimal,
  index,
} from "drizzle-orm/pg-core";

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
