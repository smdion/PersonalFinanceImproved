// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  integer,
  date,
  decimal,
  index,
} from "drizzle-orm/pg-core";
import { savingsGoals } from "./savings";

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
