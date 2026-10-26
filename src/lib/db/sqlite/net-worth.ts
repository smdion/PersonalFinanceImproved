// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { people } from "./people";

// ────────────────────────────────────────────────────────────────────────────
// 8. Net worth (annual)
// ────────────────────────────────────────────────────────────────────────────

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
  houseValue: text("house_value").notNull().default("0"),
  retirementTotal: text("retirement_total").notNull().default("0"),
  hsa: text("hsa").notNull().default("0"),
  ltBrokerage: text("lt_brokerage").notNull().default("0"),
  espp: text("espp").notNull().default("0"),
  rBrokerage: text("r_brokerage").notNull().default("0"),
  otherAssets: text("other_assets").notNull().default("0"),
  // Liabilities
  mortgageBalance: text("mortgage_balance").notNull().default("0"),
  otherLiabilities: text("other_liabilities").notNull().default("0"),
  // Breakdowns
  taxFreeTotal: text("tax_free_total").notNull().default("0"),
  taxDeferredTotal: text("tax_deferred_total").notNull().default("0"),
  portfolioTotal: text("portfolio_total").notNull().default("0"),
  propertyTaxes: text("property_taxes"),
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
  cost: text("cost").notNull(),
  note: text("note"),
});

// A person's recorded salary + paid bonus for one year — a direct fact,
// the same as every other Historical year-end field (grossIncome,
// combinedAgi, etc). Not derived from a job or any ledger — a job carries
// no salary/bonus of its own (see jobs above), and there is no dated
// raise/bonus history to walk. The current (in-progress) year has no row
// here yet; it auto-fills from the active Salary Profile until recorded.
export const historicalSalaries = sqliteTable(
  "historical_salaries",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    salary: text("salary").notNull(),
    bonus: text("bonus").notNull().default("0"),
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
