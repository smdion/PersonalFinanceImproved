// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { savingsGoals } from "./savings";

// ────────────────────────────────────────────────────────────────────────────
// 6. Self loans
// ────────────────────────────────────────────────────────────────────────────

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
    repaidAmount: text("repaid_amount").notNull().default("0"),
    repaidDate: text("repaid_date"),
  },
  (table) => [
    index("self_loans_from_goal_id_idx").on(table.fromGoalId),
    index("self_loans_to_goal_id_idx").on(table.toGoalId),
  ],
);
