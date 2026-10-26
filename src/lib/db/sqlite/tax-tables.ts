// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

import type { W4FilingStatus } from "@/lib/config/enum-values";
import { referenceOriginColumns } from "./contributions";

// ────────────────────────────────────────────────────────────────────────────
// 11. Return rates & tax tables
// ────────────────────────────────────────────────────────────────────────────

export const returnRateTable = sqliteTable("return_rate_table", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  age: integer("age").notNull().unique(),
  rateOfReturn: text("rate_of_return").notNull(),
});

export type TaxBracketEntry = {
  threshold: number;
  baseWithholding: number;
  rate: number;
};

export const taxBrackets = sqliteTable(
  "tax_brackets",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    w4Checkbox: integer("w4_checkbox", { mode: "boolean" }).notNull(),
    brackets: text("brackets", { mode: "json" })
      .$type<TaxBracketEntry[]>()
      .notNull(),
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

export const ltcgBrackets = sqliteTable(
  "ltcg_brackets",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    brackets: text("brackets", { mode: "json" })
      .$type<LtcgBracketEntry[]>()
      .notNull(),
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

export const irmaaBrackets = sqliteTable(
  "irmaa_brackets",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status").$type<W4FilingStatus>().notNull(),
    brackets: text("brackets", { mode: "json" })
      .$type<IrmaaBracketEntry[]>()
      .notNull(),
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

export const fplByHousehold = sqliteTable(
  "fpl_by_household",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    taxYear: integer("tax_year").notNull(),
    amounts: text("amounts", { mode: "json" })
      .$type<Record<string, number>>()
      .notNull(),
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

export const taxParams = sqliteTable(
  "tax_params",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    taxYear: integer("tax_year").notNull(),
    version: integer("version").notNull().default(1),
    source: text("source"),
    notes: text("notes"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("tax_params_year_idx").on(table.taxYear),
    // version is a monotonic
    // "Tax data: 2026, rev N" revision counter — never meaningfully zero
    // or negative. Cheap to enforce now, before any admin-facing mutation
    // of this column ships.
    // prettier-ignore
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
