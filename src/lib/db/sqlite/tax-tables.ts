// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { decimalText } from "../sqlite-decimal";

import type {
  FilingStatusKey,
  W4FilingStatus,
} from "@/lib/config/filing-status";
import { referenceOriginColumns } from "./contributions";

// ────────────────────────────────────────────────────────────────────────────
// 11. Return rates & tax tables
// ────────────────────────────────────────────────────────────────────────────

export const returnRateTable = sqliteTable("return_rate_table", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  age: integer("age").notNull().unique(),
  rateOfReturn: decimalText("rate_of_return").notNull(),
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
    filingStatus: text("filing_status").$type<FilingStatusKey>().notNull(),
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
    filingStatus: text("filing_status").$type<FilingStatusKey>().notNull(),
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
// One row per ACA coverage year (HHS publishes a year earlier; 26 CFR §1.36B-1(h)).
// `amounts` maps household size "1".."8" to the annual FPL dollar figure.

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
// Per-year vintage markers, no figures: `resolveTaxParams` maps a year to a resolved year
// here, then reads the value tables. With no rows it uses their MAX(tax_year).

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
    // version is a "Tax data: 2026, rev N" revision counter, always positive.
    // prettier-ignore
  ],
);

export type ApiConfig = Record<string, string | undefined>;

export type AccountMapping = {
  // "performance:{id}" | "asset:{id}" | "debt:{id}" | "mortgage:{loanId}:{type}", or the
  // pseudo-accounts "cash" | "creditCard" that many mappings share (summed by getEffectiveCash /
  // getEffectiveCreditCardDebt; applyPullMapping skips them).
  localId?: string;
  localName: string; // Cached display name (UI only, not for resolution)
  remoteAccountId: string;
  syncDirection: "pull" | "push" | "both";
  // Typed ids: what a mapping resolves by (the credentials migration filled them from localId)
  assetId?: number; // Direct reference to otherAssetItems.id
  loanId?: number; // Direct reference to mortgageLoans.id
  loanMapType?: "propertyValue" | "loanBalance"; // What the mortgage mapping controls
  debtId?: number; // Direct reference to debts.id (its pulled balance)
  performanceAccountId?: number; // Direct reference to performanceAccounts.id
};
