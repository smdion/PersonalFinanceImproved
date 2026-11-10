// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  decimal,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { jsonb } from "../pg-jsonb";
import { sql } from "drizzle-orm";
import type {
  ReturnFilingStatus,
  W4FilingStatus,
} from "@/lib/config/filing-status";
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
    filingStatus: text("filing_status").$type<ReturnFilingStatus>().notNull(),
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
    filingStatus: text("filing_status").$type<ReturnFilingStatus>().notNull(),
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
// One row per ACA coverage year (HHS publishes a year earlier; 26 CFR §1.36B-1(h)).
// `amounts` maps household size "1".."8" to the annual FPL dollar figure.

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
// Per-year vintage markers, no figures: `resolveTaxParams` maps a year to a resolved year
// here, then reads the value tables. With no rows it uses their MAX(tax_year).

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
    // version is a "Tax data: 2026, rev N" revision counter, always positive.
    // prettier-ignore
    check(
      "tax_params_version_positive",
      sql`version > 0`,
    ),
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
