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
  index,
  check,
} from "drizzle-orm/pg-core";
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

export const contributionAccounts = pgTable(
  "contribution_accounts",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    personId: integer("person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    accountType: text("account_type").notNull(),
    subType: text("sub_type"),
    label: text("label"),
    parentCategory: text("parent_category").notNull().default("Retirement"),
    taxTreatment: text("tax_treatment").$type<TaxTreatment>().notNull(),
    // No contributionMethod/contributionValue here: the amount is always a Contribution
    // Profile's active-field entry (applyContribActiveFields), never an account-row fallback.
    employerMatchType: text("employer_match_type")
      .$type<EmployerMatchType>()
      .notNull(),
    employerMatchValue: decimal("employer_match_value", {
      precision: 14,
      scale: 2,
    }),
    /** A percent match's rate as a fraction (0.5 = 50%): what is read;
     *  migration 0017 clears the whole-percent value where this is set. */
    employerMatchRate: decimal("employer_match_rate", {
      precision: 12,
      scale: 6,
    }),
    employerMaxMatchPct: decimal("employer_max_match_pct", {
      precision: 8,
      scale: 6,
    }),
    employerMatchTaxTreatment: text("employer_match_tax_treatment")
      .$type<MatchTaxTreatment>()
      .notNull()
      .default("pre_tax"),
    hsaCoverageType: text("hsa_coverage_type").$type<HsaCoverageType>(),
    autoMaximize: boolean("auto_maximize").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ownership: text("ownership")
      .$type<AccountOwnership>()
      .notNull()
      .default("individual"),
    performanceAccountId: integer("performance_account_id").references(
      () => performanceAccounts.id,
      { onDelete: "set null" },
    ),
    targetAnnual: decimal("target_annual", { precision: 14, scale: 2 }),
    allocationPriority: integer("allocation_priority").notNull().default(0),
    notes: text("notes"),
    isPayrollDeducted: boolean("is_payroll_deducted"),
    priorYearContribAmount: decimal("prior_year_contrib_amount", {
      precision: 14,
      scale: 2,
    })
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
    check(
      "contribution_accounts_parent_cat_check",
      sql`parent_category IN ('Retirement', 'Portfolio')`,
    ),
    // At most one active row per (job, accountType, parentCategory), or per person when jobless,
    // may carry employer match config: computeGroupedEmployerMatch throws on two configured
    // siblings, so these indexes stop that state being written.
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
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
};

export const contributionLimits = pgTable(
  "contribution_limits",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    limitType: text("limit_type").notNull(),
    value: decimal("value", { precision: 12, scale: 6 }).notNull(),
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

export const paycheckDeductions = pgTable(
  "paycheck_deductions",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    deductionName: text("deduction_name").notNull(),
    isPretax: boolean("is_pretax").notNull(),
    ficaExempt: boolean("fica_exempt").notNull().default(false),
  },
  (table) => [index("paycheck_deductions_job_id_idx").on(table.jobId)],
);

/**
 * Pay on a job's checks besides salary and bonus, structural only (what it is, which taxes
 * apply); the per-check amount is the Salary Profile entry's `otherEarnings[id]`. `isCash`
 * false = imputed income (e.g. group-term life over $50k, IRC 79): taxed, not take-home.
 */
export const paycheckEarnings = pgTable(
  "paycheck_earnings",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    earningName: text("earning_name").notNull(),
    isCash: boolean("is_cash").notNull().default(true),
    federalTaxable: boolean("federal_taxable").notNull().default(true),
    ficaTaxable: boolean("fica_taxable").notNull().default(true),
  },
  (table) => [index("paycheck_earnings_job_id_idx").on(table.jobId)],
);
