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
  AccountOwnership,
  RetirementBehavior,
  ContributionScaling,
  PortfolioTaxType,
} from "@/lib/config/enum-values";
import { people } from "./people";

// ────────────────────────────────────────────────────────────────────────────
// 7. Portfolio performance
// ────────────────────────────────────────────────────────────────────────────

export const performanceAccounts = sqliteTable(
  "performance_accounts",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    institution: text("institution").notNull(),
    accountType: text("account_type").notNull(),
    subType: text("sub_type"),
    label: text("label"),
    accountLabel: text("account_label").notNull(),
    displayName: text("display_name"),
    ownerPersonId: integer("owner_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    ownershipType: text("ownership_type").$type<AccountOwnership>().notNull(),
    retirementBehavior: text("retirement_behavior")
      .$type<RetirementBehavior>()
      .notNull()
      .default("stops_at_owner_retirement"),
    contributionScaling: text("contribution_scaling")
      .$type<ContributionScaling>()
      .notNull()
      .default("scales_with_salary"),
    costBasis: text("cost_basis").notNull().default("0"),
    /** Date the account owner separated from the employer funding this plan
     *  (401k/403b only) — durable, user-set source of truth for Rule of 55
     *  eligibility (Tax Buckets tool). Null = not separated yet / not
     *  applicable / not entered; the UI derives a default suggestion from
     *  linked jobs but never writes it here automatically. */
    separationDate: text("separation_date"),
    /** Household is fine paying the 10%/20% early-withdrawal penalty on
     *  THIS account when the projection needs to draw from it. Default
     *  false = today's behavior (this account participates in the
     *  household-wide hard exclusion like every other account, never
     *  touched while penalty-free money exists anywhere). True makes this
     *  account's penalty-exposed balance normally withdrawable again —
     *  ordinary routing order (waterfall/bracket-filling) decides WHEN it's
     *  drawn, same as any other reachable dollar. This is NOT a strict
     *  "only as a true last resort, after every other account is
     *  exhausted" guarantee — that would require reordering withdrawal
     *  routing across account categories, a larger change tracked
     *  separately. One-way opt-in per
     *  account, set by the user — never inferred. */
    allowPenalizedWithdrawals: integer("allow_penalized_withdrawals", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    parentCategory: text("parent_category").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("performance_accounts_inst_type_idx").on(
      table.institution,
      table.accountType,
      table.subType,
      table.label,
      table.ownerPersonId,
    ),
    index("idx_perf_accounts_inst_label").on(
      table.institution,
      table.accountLabel,
    ),
    index("performance_accounts_owner_id_idx").on(table.ownerPersonId),
    index("performance_accounts_category_idx").on(table.parentCategory),
    index("performance_accounts_is_active_idx").on(table.isActive),
  ],
);

/** Manually-tracked basis for the Tax Buckets analysis tool — how much of a
 *  Roth (taxFree) balance is contribution/conversion basis (accessible
 *  penalty-free under IRS ordering rules, for a Roth IRA) vs. growth. Keyed
 *  by (performanceAccountId, ownerPersonId), not a single column on
 *  performanceAccounts, because one account can carry two people's balances
 *  (e.g. a jointly-labeled Roth IRA with separate per-owner amounts).
 *  Named `account_basis` (not `roth_basis`) since it's the intended future
 *  home for other basis kinds (e.g. brokerage cost basis) — currently holds
 *  Roth fields only; brokerage cost basis still lives as a single live
 *  column on performanceAccounts (see tracksCostBasis()), unmigrated. */
/** Year-scoped to mirror accountPerformance/annualPerformance's
 *  live-then-finalized lifecycle: one row per (account, owner, year),
 *  mutable while current, locked by finalizeRothBasisForYear() when
 *  performance.finalizeYear runs. */
export const accountBasis = sqliteTable(
  "account_basis",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    performanceAccountId: integer("performance_account_id")
      .notNull()
      .references(() => performanceAccounts.id, { onDelete: "cascade" }),
    ownerPersonId: integer("owner_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    year: integer("year").notNull(),
    /** Contributions — always penalty-free and tax-free, no seasoning clock. */
    contributionBasis: text("contribution_basis").notNull().default("0"),
    /** Roth conversions — always tax-free, but penalty-free only once
     *  seasoned (see latestConversionYear). */
    conversionBasis: text("conversion_basis").notNull().default("0"),
    /** Most recent tax year a conversion was made, if conversionBasis > 0.
     *  Gating the whole conversionBasis figure on the LATEST (not earliest)
     *  tracked conversion year is deliberately conservative: this is a
     *  pooled total across potentially several years of conversions, so
     *  using the latest year only ever understates penalty-free access,
     *  never overstates it. Null if conversionBasis = 0. */
    latestConversionYear: integer("latest_conversion_year"),
    isFinalized: integer("is_finalized", { mode: "boolean" })
      .notNull()
      .default(false),
    /** True for a row auto-seeded by finalizeRothBasisForYear (carried
     *  forward from the prior year, not yet reviewed) vs. one the user
     *  actually entered/confirmed. Basis normally grows each year, so an
     *  unreviewed seeded row left as-is would silently understate
     *  accessible funds — cleared the moment updateRothBasis touches it. */
    isSeeded: integer("is_seeded", { mode: "boolean" })
      .notNull()
      .default(false),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("account_basis_account_owner_year_idx").on(
      table.performanceAccountId,
      table.ownerPersonId,
      table.year,
    ),
    index("account_basis_owner_person_id_idx").on(table.ownerPersonId),
    index("account_basis_year_idx").on(table.year),
  ],
);

export const portfolioSnapshots = sqliteTable(
  "portfolio_snapshots",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    snapshotDate: text("snapshot_date").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    notes: text("notes"),
  },
  (table) => [index("portfolio_snapshots_date_idx").on(table.snapshotDate)],
);

export const portfolioAccounts = sqliteTable(
  "portfolio_accounts",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => portfolioSnapshots.id, { onDelete: "cascade" }),
    institution: text("institution").notNull(),
    taxType: text("tax_type").$type<PortfolioTaxType>().notNull(),
    amount: text("amount").notNull(),
    accountType: text("account_type").notNull(),
    subType: text("sub_type"),
    label: text("label"),
    parentCategory: text("parent_category").notNull().default("Retirement"),
    ownerPersonId: integer("owner_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    performanceAccountId: integer("performance_account_id").references(
      () => performanceAccounts.id,
      { onDelete: "set null" },
    ),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    index("portfolio_accounts_snapshot_id_idx").on(table.snapshotId),
    index("portfolio_accounts_owner_id_idx").on(table.ownerPersonId),
    index("portfolio_accounts_perf_acct_idx").on(table.performanceAccountId),
    index("portfolio_accounts_acct_type_idx").on(table.accountType),
    index("portfolio_accounts_parent_cat_idx").on(table.parentCategory),
    index("portfolio_accounts_is_active_idx").on(table.isActive),
  ],
);

export const annualPerformance = sqliteTable(
  "annual_performance",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    year: integer("year").notNull(),
    category: text("category").notNull(),
    beginningBalance: text("beginning_balance").notNull(),
    totalContributions: text("total_contributions").notNull(),
    yearlyGainLoss: text("yearly_gain_loss").notNull(),
    endingBalance: text("ending_balance").notNull(),
    annualReturnPct: text("annual_return_pct"),
    employerContributions: text("employer_contributions")
      .notNull()
      .default("0"),
    distributions: text("distributions").notNull().default("0"),
    fees: text("fees").notNull().default("0"),
    rollovers: text("rollovers").notNull().default("0"),
    lifetimeGains: text("lifetime_gains").notNull(),
    lifetimeContributions: text("lifetime_contributions").notNull(),
    lifetimeMatch: text("lifetime_match").notNull(),
    isCurrentYear: integer("is_current_year", { mode: "boolean" })
      .notNull()
      .default(false),
    isFinalized: integer("is_finalized", { mode: "boolean" })
      .notNull()
      .default(false),
    /** When true, this row's lifetime_* fields are considered authoritative
     *  and must not be edited via routers. Set on finalization. App-layer
     *  enforcement guards against silent drift when account_performance
     *  rows on a finalized year are edited (per RULES.md § Data Model
     *  Principles point 4 cascade rule). The router-level guard in
     *  performance.ts:updateAnnual is the real protection — these fields
     *  intentionally have NO CHECK constraints because lifetime_gains
     *  can legitimately be negative (cumulative losses across years). */
    isImmutable: integer("is_immutable", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex("annual_performance_year_cat_idx").on(
      table.year,
      table.category,
    ),
  ],
);

export const accountPerformance = sqliteTable(
  "account_performance",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    year: integer("year").notNull(),
    institution: text("institution").notNull(),
    accountLabel: text("account_label").notNull(),
    ownerPersonId: integer("owner_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    beginningBalance: text("beginning_balance").notNull(),
    totalContributions: text("total_contributions").notNull(),
    yearlyGainLoss: text("yearly_gain_loss").notNull(),
    endingBalance: text("ending_balance").notNull(),
    annualReturnPct: text("annual_return_pct"),
    employerContributions: text("employer_contributions")
      .notNull()
      .default("0"),
    fees: text("fees").notNull().default("0"),
    distributions: text("distributions").notNull().default("0"),
    rollovers: text("rollovers").notNull().default("0"),
    parentCategory: text("parent_category").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isFinalized: integer("is_finalized", { mode: "boolean" })
      .notNull()
      .default(false),
    performanceAccountId: integer("performance_account_id")
      .notNull()
      .references(() => performanceAccounts.id, { onDelete: "restrict" }),
    /** The household's note on this account-year: where figures came
     *  from, why a gap is fine. */
    note: text("note"),
    /** Figures still estimated (PerfField names — parseEstimatedFields). */
    estimatedFields: text("estimated_fields", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    /** Reconciliation gaps accepted as on purpose, by check kind
     *  (parseAcceptedChecks). */
    acceptedChecks: text("accepted_checks", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
  },
  (table) => [
    uniqueIndex("account_perf_year_inst_label_owner_idx").on(
      table.year,
      table.institution,
      table.accountLabel,
      table.ownerPersonId,
    ),
    index("account_performance_owner_id_idx").on(table.ownerPersonId),
    index("account_performance_perf_acct_idx").on(table.performanceAccountId),
    index("account_performance_is_active_idx").on(table.isActive),
  ],
);
