// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  date,
  decimal,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { people } from "./people";

// ────────────────────────────────────────────────────────────────────────────
// 8. Net worth (annual)
// ────────────────────────────────────────────────────────────────────────────

export const netWorthAnnual = pgTable("net_worth_annual", {
  id: serial("id").primaryKey(),
  yearEndDate: date("year_end_date").notNull().unique(),
  grossIncome: decimal("gross_income", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  combinedAgi: decimal("combined_agi", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  ssaEarnings: decimal("ssa_earnings", { precision: 14, scale: 2 }),
  effectiveTaxRate: decimal("effective_tax_rate", { precision: 8, scale: 6 }),
  taxesPaid: decimal("taxes_paid", { precision: 14, scale: 2 }),
  // Assets
  cash: decimal("cash", { precision: 14, scale: 2 }).notNull().default("0"),
  houseValue: decimal("house_value", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  retirementTotal: decimal("retirement_total", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  hsa: decimal("hsa", { precision: 14, scale: 2 }).notNull().default("0"),
  ltBrokerage: decimal("lt_brokerage", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  espp: decimal("espp", { precision: 14, scale: 2 }).notNull().default("0"),
  rBrokerage: decimal("r_brokerage", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  otherAssets: decimal("other_assets", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  // Liabilities
  mortgageBalance: decimal("mortgage_balance", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  otherLiabilities: decimal("other_liabilities", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  // Breakdowns
  taxFreeTotal: decimal("tax_free_total", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  taxDeferredTotal: decimal("tax_deferred_total", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  portfolioTotal: decimal("portfolio_total", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  propertyTaxes: decimal("property_taxes", { precision: 14, scale: 2 }),
  // Point-in-time tax location breakdown captured at finalization.
  // Shape: { retirement: { taxFree: N, preTax: N, hsa: N, afterTax: N }, portfolio: { afterTax: N } }
  portfolioByTaxLocation: jsonb("portfolio_by_tax_location")
    .$type<{
      retirement: Record<string, number>;
      portfolio: Record<string, number>;
    }>()
    .notNull(),
});

// Home improvement individual items — cumulative sum per year
export const homeImprovementItems = pgTable("home_improvement_items", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  description: text("description").notNull(),
  cost: decimal("cost", { precision: 14, scale: 2 }).notNull(),
  note: text("note"),
});

// A person's recorded salary + paid bonus for one year — a direct fact,
// the same as every other Historical year-end field (grossIncome,
// combinedAgi, etc). Not derived from a job or any ledger — a job carries
// no salary/bonus of its own (see jobs above), and there is no dated
// raise/bonus history to walk. The current (in-progress) year has no row
// here yet; it auto-fills from the active Salary Profile until recorded.
export const historicalSalaries = pgTable(
  "historical_salaries",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    salary: decimal("salary", { precision: 14, scale: 2 }).notNull(),
    bonus: decimal("bonus", { precision: 14, scale: 2 }).notNull().default("0"),
  },
  (table) => [
    uniqueIndex("historical_salaries_person_year_idx").on(
      table.personId,
      table.year,
    ),
  ],
);

// Other asset items — carry-forward: latest value per name for a given year
export const otherAssetItems = pgTable(
  "other_asset_items",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    year: integer("year").notNull(),
    value: decimal("value", { precision: 14, scale: 2 }).notNull(),
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
