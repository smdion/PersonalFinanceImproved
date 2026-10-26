// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ────────────────────────────────────────────────────────────────────────────
// 13. App config / admin
// ────────────────────────────────────────────────────────────────────────────

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
  moveYear: number | null;
};
