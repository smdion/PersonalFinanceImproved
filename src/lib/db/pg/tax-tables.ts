// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  decimal,
  jsonb,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { W4FilingStatus } from "@/lib/config/enum-values";
import { referenceOriginColumns } from "./contributions";

// ────────────────────────────────────────────────────────────────────────────
// 11. Return rates & tax tables
// ────────────────────────────────────────────────────────────────────────────

export const returnRateTable = pgTable("return_rate_table", {
  id: serial("id").primaryKey(),
  age: integer("age").notNull().unique(),
  rateOfReturn: decimal("rate_of_return", { precision: 8, scale: 6 }).notNull(),
});

export type TaxBracketEntry = {
  threshold: number;
  baseWithholding: number;
  rate: number;
};

export const taxBrackets = pgTable(
  "tax_brackets",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    w4Checkbox: boolean("w4_checkbox").notNull(),
    brackets: jsonb("brackets").$type<TaxBracketEntry[]>().notNull(),
    ...referenceOriginColumns,
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
  threshold: number | null; // null = Infinity (top bracket)
  rate: number;
};

export const ltcgBrackets = pgTable(
  "ltcg_brackets",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    brackets: jsonb("brackets").$type<LtcgBracketEntry[]>().notNull(),
    ...referenceOriginColumns,
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

export const irmaaBrackets = pgTable(
  "irmaa_brackets",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    brackets: jsonb("brackets").$type<IrmaaBracketEntry[]>().notNull(),
    ...referenceOriginColumns,
  },
  (table) => [
    uniqueIndex("irmaa_brackets_year_status_idx").on(
      table.taxYear,
      table.filingStatus,
    ),
  ],
);

// ── ACA Federal Poverty Level ──────────────────────────────────
//
// One row per ACA COVERAGE year (not the HHS publication year, which is
// one calendar year earlier — 26 CFR §1.36B-1(h)). `amounts` maps
// household size "1".."8" to the annual FPL dollar figure.

export const fplByHousehold = pgTable(
  "fpl_by_household",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    amounts: jsonb("amounts").$type<Record<string, number>>().notNull(),
    ...referenceOriginColumns,
  },
  (table) => [uniqueIndex("fpl_by_household_year_idx").on(table.taxYear)],
);

// ── Tax-parameter vintage rows ─────────────────────────────────
//
// A thin per-year vintage marker. It carries NO figure values — the
// existing `contribution_limits` / `tax_brackets` / `ltcg_brackets` /
// `irmaa_brackets` / `fpl_by_household` tables remain the one and only value
// store. `resolveTaxParams` maps a requested year to a resolved year via
// these rows, then reads the value tables for that year. `version` is a
// human-legible "Tax data: 2026, rev N" counter — cache coherence comes from
// the resolved values themselves (already in the engine-input hash), not
// from this column. Absent entirely (old-backup restore) ⇒ the resolver
// falls back to the value tables' own MAX(tax_year), i.e. today's behaviour.

export const taxParams = pgTable(
  "tax_params",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    version: integer("version").notNull().default(1),
    source: text("source"),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("tax_params_year_idx").on(table.taxYear),
    // version is a monotonic
    // "Tax data: 2026, rev N" revision counter — never meaningfully zero
    // or negative. Cheap to enforce now, before any admin-facing mutation
    // of this column ships.
    // prettier-ignore
    check(
      "tax_params_version_positive",
      sql`version > 0`,
    ),
  ],
);

export type ApiConfig = Record<string, string | undefined>;

export type AccountMapping = {
  // "performance:{id}" | "asset:{id}" | "mortgage:{loanId}:{type}" (legacy
  // prefix format) | "cash" | "creditCard" (fixed pseudo-accounts — many
  // mappings can share these two values, summed by getEffectiveCash /
  // getEffectiveCreditCardDebt; never resolve to a single Ledgr row the
  // way the others do, and applyPullMapping skips them on purpose).
  localId?: string;
  localName: string; // Cached display name (UI only, not for resolution)
  remoteAccountId: string;
  syncDirection: "pull" | "push" | "both";
  // Typed ID fields — preferred over parsing localId prefix strings
  assetId?: number; // Direct reference to otherAssetItems.id
  loanId?: number; // Direct reference to mortgageLoans.id
  loanMapType?: "propertyValue" | "loanBalance"; // What the mortgage mapping controls
  performanceAccountId?: number; // Direct reference to performanceAccounts.id
};
