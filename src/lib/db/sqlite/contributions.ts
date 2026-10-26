// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — see schema-pg.ts.

import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

import type {
  TaxTreatment,
  MatchTaxTreatment,
  EmployerMatchType,
  HsaCoverageType,
  AccountOwnership,
} from "@/lib/config/enum-values";
import type { TaxDataOrigin } from "../reference-reconcile-core";
import { jobs, people } from "./people";
import { performanceAccounts } from "./performance";

// ────────────────────────────────────────────────────────────────────────────
// 2. Contributions & Paycheck
// ────────────────────────────────────────────────────────────────────────────

export const contributionAccounts = sqliteTable(
  "contribution_accounts",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    personId: integer("person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    accountType: text("account_type").notNull(),
    subType: text("sub_type"),
    label: text("label"),
    parentCategory: text("parent_category").notNull().default("Retirement"),
    taxTreatment: text("tax_treatment").$type<TaxTreatment>().notNull(),
    // contributionMethod/contributionValue deliberately do NOT live here —
    // an account is purely structural (what it IS); the actual contribution
    // amount/method is ALWAYS a Contribution Profile's active-field entry
    // (contribution_profiles.contribution_active_fields), never a fallback
    // column on the account row. See applyContribActiveFields — there is no
    // base-value fallback, an account with no active entry has no value.
    employerMatchType: text("employer_match_type")
      .$type<EmployerMatchType>()
      .notNull(),
    employerMatchValue: text("employer_match_value"),
    employerMaxMatchPct: text("employer_max_match_pct"),
    employerMatchTaxTreatment: text("employer_match_tax_treatment")
      .$type<MatchTaxTreatment>()
      .notNull()
      .default("pre_tax"),
    hsaCoverageType: text("hsa_coverage_type").$type<HsaCoverageType>(),
    autoMaximize: integer("auto_maximize", { mode: "boolean" })
      .notNull()
      .default(false),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ownership: text("ownership")
      .$type<AccountOwnership>()
      .notNull()
      .default("individual"),
    performanceAccountId: integer("performance_account_id").references(
      () => performanceAccounts.id,
      { onDelete: "set null" },
    ),
    targetAnnual: text("target_annual"),
    allocationPriority: integer("allocation_priority").notNull().default(0),
    notes: text("notes"),
    isPayrollDeducted: integer("is_payroll_deducted", { mode: "boolean" }),
    priorYearContribAmount: text("prior_year_contrib_amount")
      .notNull()
      .default("0"),
    priorYearContribYear: integer("prior_year_contrib_year"),
  },
  (table) => [
    index("contribution_accounts_job_id_idx").on(table.jobId),
    index("contribution_accounts_person_id_idx").on(table.personId),
    index("contribution_accounts_perf_acct_idx").on(table.performanceAccountId),
    index("contribution_accounts_acct_type_idx").on(table.accountType),
    index("contribution_accounts_parent_cat_idx").on(table.parentCategory),
    index("contribution_accounts_is_active_idx").on(table.isActive),
    // At most one active row per (job, accountType, parentCategory) may
    // carry real employer match config. computeGroupedEmployerMatch
    // (server/helpers/contribution.ts) combines a physical account's
    // Roth/Traditional splits before applying the match cap once, and
    // requires exactly one "winning" row's config for that group — two
    // independently-configured siblings is an ambiguous state the app
    // throws on rather than silently guessing at. These two indexes (job-
    // linked and jobless-fallback-to-person, matching every caller's own
    // resolution convention) stop that state from being written at all.
    uniqueIndex("contribution_accounts_job_match_unq")
      .on(table.jobId, table.accountType, table.parentCategory)
      .where(
        sql`${table.employerMatchType} <> 'none' AND ${table.jobId} IS NOT NULL AND ${table.isActive} = true`,
      ),
    uniqueIndex("contribution_accounts_person_match_unq")
      .on(table.personId, table.accountType, table.parentCategory)
      .where(
        sql`${table.employerMatchType} <> 'none' AND ${table.jobId} IS NULL AND ${table.isActive} = true`,
      ),
  ],
);

/**
 * Where a reference figure came from (tax-data file, carried forward, the
 * sync, or the household) — the reconcile updates shipped figures and never
 * the household's (lib/db/reference-reconcile-core.ts).
 */
export const referenceOriginColumns = {
  origin: text("origin").$type<TaxDataOrigin>().notNull().default("user"),
  /** The tax-data file's `dataVersion` a `seed`/`community` row came from. */
  sourceVersion: integer("source_version"),
  /** When the household last confirmed or changed this figure. */
  confirmedAt: integer("confirmed_at", { mode: "timestamp" }),
};

export const contributionLimits = sqliteTable(
  "contribution_limits",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    taxYear: integer("tax_year").notNull(),
    limitType: text("limit_type").notNull(),
    value: text("value").notNull(),
    notes: text("notes"),
    ...referenceOriginColumns,
  },
  (table) => [
    uniqueIndex("contribution_limits_year_type_idx").on(
      table.taxYear,
      table.limitType,
    ),
  ],
);

export const paycheckDeductions = sqliteTable(
  "paycheck_deductions",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    deductionName: text("deduction_name").notNull(),
    isPretax: integer("is_pretax", { mode: "boolean" }).notNull(),
    ficaExempt: integer("fica_exempt", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [index("paycheck_deductions_job_id_idx").on(table.jobId)],
);

/**
 * Pay on a job's checks besides salary and bonus — structural only, like
 * paycheck_deductions: what the line is and which taxes apply. The amount
 * per check lives in the Salary Profile entry (`otherEarnings`, keyed by
 * this id), the same axis as salary and bonus. `isCash` false = a taxable
 * benefit that's never paid (imputed income, e.g. group-term life over
 * $50k — IRC 79): taxed, but not take-home.
 */
export const paycheckEarnings = sqliteTable(
  "paycheck_earnings",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    earningName: text("earning_name").notNull(),
    isCash: integer("is_cash", { mode: "boolean" }).notNull().default(true),
    federalTaxable: integer("federal_taxable", { mode: "boolean" })
      .notNull()
      .default(true),
    ficaTaxable: integer("fica_taxable", { mode: "boolean" })
      .notNull()
      .default(true),
  },
  (table) => [index("paycheck_earnings_job_id_idx").on(table.jobId)],
);
