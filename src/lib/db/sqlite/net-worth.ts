// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { decimalText } from "../sqlite-decimal";

import { people } from "./people";

// ────────────────────────────────────────────────────────────────────────────
// 8. Net worth (annual)
// ────────────────────────────────────────────────────────────────────────────

export const netWorthAnnual = sqliteTable("net_worth_annual", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  yearEndDate: text("year_end_date").notNull().unique(),
  grossIncome: decimalText("gross_income").notNull().default("0"),
  combinedAgi: decimalText("combined_agi").notNull().default("0"),
  ssaEarnings: decimalText("ssa_earnings"),
  effectiveTaxRate: decimalText("effective_tax_rate"),
  taxesPaid: decimalText("taxes_paid"),
  // Assets
  cash: decimalText("cash").notNull().default("0"),
  houseValue: decimalText("house_value").notNull().default("0"),
  retirementTotal: decimalText("retirement_total").notNull().default("0"),
  hsa: decimalText("hsa").notNull().default("0"),
  ltBrokerage: decimalText("lt_brokerage").notNull().default("0"),
  espp: decimalText("espp").notNull().default("0"),
  rBrokerage: decimalText("r_brokerage").notNull().default("0"),
  otherAssets: decimalText("other_assets").notNull().default("0"),
  // Liabilities
  mortgageBalance: decimalText("mortgage_balance").notNull().default("0"),
  otherLiabilities: decimalText("other_liabilities").notNull().default("0"),
  // Breakdowns
  taxFreeTotal: decimalText("tax_free_total").notNull().default("0"),
  taxDeferredTotal: decimalText("tax_deferred_total").notNull().default("0"),
  portfolioTotal: decimalText("portfolio_total").notNull().default("0"),
  propertyTaxes: decimalText("property_taxes"),
  // Point-in-time tax location breakdown captured at finalization.
  // Shape: { retirement: { taxFree: N, preTax: N, hsa: N, afterTax: N }, portfolio: { afterTax: N } }
  portfolioByTaxLocation: text("portfolio_by_tax_location", { mode: "json" })
    .$type<{
      retirement: Record<string, number>;
      portfolio: Record<string, number>;
    }>()
    .notNull(),
});

// Home improvement individual items — cumulative sum per year
export const homeImprovementItems = sqliteTable("home_improvement_items", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  year: integer("year").notNull(),
  description: text("description").notNull(),
  cost: decimalText("cost").notNull(),
  note: text("note"),
});

// A person's recorded salary + paid bonus for one year: a direct fact like other Historical
// fields, not derived from a job (jobs carry no pay). The in-progress year has no row; it
// auto-fills from the active Salary Profile until recorded.
export const historicalSalaries = sqliteTable(
  "historical_salaries",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    salary: decimalText("salary").notNull(),
    bonus: decimalText("bonus").notNull().default("0"),
  },
  (table) => [
    uniqueIndex("historical_salaries_person_year_idx").on(
      table.personId,
      table.year,
    ),
  ],
);

// Other asset items — carry-forward: latest value per name for a given year
export const otherAssetItems = sqliteTable(
  "other_asset_items",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    year: integer("year").notNull(),
    value: decimalText("value").notNull(),
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
