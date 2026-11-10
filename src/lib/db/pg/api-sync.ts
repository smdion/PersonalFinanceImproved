// Part of the Drizzle schema (PostgreSQL) — see schema-pg.ts.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  date,
  timestamp,
  decimal,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { jsonb } from "../pg-jsonb";
import { sql } from "drizzle-orm";
import type {
  InvestmentTransactionKind,
  SecurityKind,
  SecurityFactSource,
  FactsBasis,
  HoldingSource,
  HoldingPeriodBasis,
  StandInPreview,
  TaxDataUpdateStatus,
} from "@/lib/config/enum-values";
import type { BudgetApiService } from "@/lib/config/budget-apps";
import { mortgageLoans } from "./mortgages";
import { performanceAccounts } from "./performance";
import type { AccountMapping, ApiConfig } from "./tax-tables";

// ────────────────────────────────────────────────────────────────────────────
// 12. API sync
// ────────────────────────────────────────────────────────────────────────────

export const apiConnections = pgTable(
  "api_connections",
  {
    id: serial("id").primaryKey(),
    service: text("service").notNull().unique(),
    config: jsonb("config").$type<ApiConfig>().notNull(),
    accountMappings: jsonb("account_mappings").$type<AccountMapping[]>(),
    skippedCategoryIds: jsonb("skipped_category_ids").$type<string[]>(),
    // A budgetProfiles.id (no DB-level FK), looked up in server code; never an id
    // from another table despite the generic name.
    linkedProfileId: integer("linked_profile_id"),
    linkedColumnIndex: integer("linked_column_index"),
    serverKnowledge: integer("server_knowledge"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (table) => [
    index("api_connections_linked_profile_id_idx").on(table.linkedProfileId),
  ],
);

export const budgetApiCache = pgTable(
  "budget_api_cache",
  {
    id: serial("id").primaryKey(),
    service: text("service").$type<BudgetApiService>().notNull(),
    cacheKey: text("cache_key").notNull(),
    data: jsonb("data").$type<unknown>().notNull(),
    serverKnowledge: integer("server_knowledge"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("budget_api_cache_service_key_idx").on(
      table.service,
      table.cacheKey,
    ),
  ],
);

/**
 * Server-side cache of projection results (deterministic, Monte Carlo, Coast FIRE MC), apart
 * from budgetApiCache (whose clear re-pulls a remote mirror) with its own eviction. `seed` is
 * stored with the result it produced; a miss (new inputs, or "Re-run") gets a fresh seed.
 */
export const projectionCache = pgTable(
  "projection_cache",
  {
    id: serial("id").primaryKey(),
    /** sha256 of the canonical engine input (hashEngineInput in projection-cache.ts); the
     *  procedure kind is folded into the hashed input, not a separate column. */
    inputHash: text("input_hash").notNull(),
    /** Random seed used for this computation — null for the deterministic
     *  engine result, which has no randomness to seed. */
    seed: integer("seed"),
    result: jsonb("result").$type<unknown>().notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** A hash of the engine code (src/lib/generated/engine-hash.ts): rows
     *  written by other code never match. See PROJECTION_CACHE_ENGINE_VERSION. */
    engineVersion: integer("engine_version").notNull(),
  },
  (table) => [
    uniqueIndex("projection_cache_hash_version_idx").on(
      table.inputHash,
      table.engineVersion,
    ),
    index("projection_cache_expires_at_idx").on(table.expiresAt),
  ],
);

export const simplefinBalanceSnapshots = pgTable(
  "simplefin_balance_snapshots",
  {
    id: serial("id").primaryKey(),
    snapshotDate: date("snapshot_date").notNull().unique(),
    totalBalance: decimal("total_balance", {
      precision: 14,
      scale: 2,
    }).notNull(),
    accountCount: integer("account_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("simplefin_balance_snapshots_date_idx").on(table.snapshotDate),
  ],
);

// ── Investments data foundation ───────────────────────────────────────────
// What SimpleFIN keeps only 90 days (holdings, transactions) is stored as sent. Transaction
// kinds are computed on read (simplefin-transactions.ts); only explicit overrides are stored.

/**
 * Daily Tiingo closes (raw close plus that day's distribution and split), each fetched once;
 * total return is built from these, never Tiingo's re-based adjusted close. Not household data.
 */
export const marketCloses = pgTable(
  "market_closes",
  {
    id: serial("id").primaryKey(),
    ticker: text("ticker").notNull(),
    date: date("date").notNull(),
    close: decimal("close", { precision: 18, scale: 6 }).notNull(),
    divCash: decimal("div_cash", { precision: 18, scale: 6 })
      .notNull()
      .default("0"),
    splitFactor: decimal("split_factor", { precision: 18, scale: 8 })
      .notNull()
      .default("1"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("market_closes_ticker_date_idx").on(table.ticker, table.date),
  ],
);

/** A fund/security as an institution reports it. */
export const securities = pgTable(
  "securities",
  {
    id: serial("id").primaryKey(),
    /** Validated public ticker (uppercase) — set only once confirmed, never a raw pseudo-symbol. */
    ticker: text("ticker"),
    /** Symbol exactly as the institution sent it (may be a plan pseudo-symbol). */
    sourceSymbol: text("source_symbol"),
    name: text("name").notNull(),
    kind: text("kind").$type<SecurityKind>().notNull(),
    /** Identity for funds with no ticker: SimpleFIN org name + description. */
    institution: text("institution"),
    sourceDescription: text("source_description"),
    /** SEC identity of this fund (series + share class), when it is registered. */
    secSeriesId: text("sec_series_id"),
    secClassId: text("sec_class_id"),
    /** Series whose filings supply the facts: this fund's own, or a confirmed stand-in. */
    factsSeriesId: text("facts_series_id"),
    factsClassId: text("facts_class_id"),
    /** Name of the series supplying the facts (shown when confirming a stand-in). */
    factsSeriesName: text("facts_series_name"),
    factsBasis: text("facts_basis").$type<FactsBasis>(),
    standinConfirmedAt: timestamp("standin_confirmed_at", {
      withTimezone: true,
    }),
    /** What a suggested (unconfirmed) stand-in's SEC filings say (coverage, mix, cheapest share
     *  class's fee) for the household to judge; never counted as this fund's facts. */
    standinPreview: jsonb("standin_preview").$type<StandInPreview>(),
    /** Last time SEC was checked for new filings (whether or not anything changed). */
    factsCheckedAt: timestamp("facts_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("securities_ticker_idx")
      .on(table.ticker)
      .where(sql`${table.ticker} IS NOT NULL`),
    uniqueIndex("securities_untickered_identity_idx")
      .on(table.institution, table.sourceDescription)
      .where(sql`${table.ticker} IS NULL`),
  ],
);

/** Composition columns shared by security_facts and sec_filing_cache: fractions of the fund, long positions only, normalised to sum to 1. */
const compositionColumns = {
  usEquityPct: decimal("us_equity_pct", { precision: 12, scale: 6 }),
  intlEquityPct: decimal("intl_equity_pct", { precision: 12, scale: 6 }),
  usBondPct: decimal("us_bond_pct", { precision: 12, scale: 6 }),
  intlBondPct: decimal("intl_bond_pct", { precision: 12, scale: 6 }),
  tipsPct: decimal("tips_pct", { precision: 12, scale: 6 }),
  cashPct: decimal("cash_pct", { precision: 12, scale: 6 }),
  otherPct: decimal("other_pct", { precision: 12, scale: 6 }),
  /** Share of the fund's holdings that could be classified (the rest is unresolved). */
  coverage: decimal("coverage", { precision: 12, scale: 6 }),
};

/**
 * Dated fund facts (expense ratio, holdings) from SEC filings (its own or a confirmed
 * stand-in's) or the household. Expense ratio and composition each come whole from one row.
 */
export const securityFacts = pgTable(
  "security_facts",
  {
    id: serial("id").primaryKey(),
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "restrict" }),
    /** Period the facts describe (filing period end), or the day the user entered them. */
    asOf: date("as_of").notNull(),
    source: text("source").$type<SecurityFactSource>().notNull(),
    /** Series the filing belongs to — differs from the fund's own when a stand-in supplied it. */
    secSeriesId: text("sec_series_id"),
    accession: text("accession"),
    /** Annual expense ratio as a fraction (0.0008 = 0.08%). */
    expenseRatio: decimal("expense_ratio", { precision: 12, scale: 6 }),
    ...compositionColumns,
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("security_facts_identity_idx").on(
      table.securityId,
      table.source,
      table.asOf,
    ),
    index("security_facts_security_idx").on(table.securityId),
    check(
      "security_facts_fraction_check",
      sql`(${table.expenseRatio} IS NULL OR (${table.expenseRatio} >= 0 AND ${table.expenseRatio} < 1))
        AND (${table.coverage} IS NULL OR (${table.coverage} >= 0 AND ${table.coverage} <= 1))`,
    ),
  ],
);

/**
 * Normalised composition of any fund's N-PORT filing, by accession — so a
 * look-through into the same underlying fund isn't downloaded twice.
 * Re-fetchable: not versioned or backed up.
 */
export const secFilingCache = pgTable(
  "sec_filing_cache",
  {
    accession: text("accession").primaryKey(),
    seriesId: text("series_id").notNull(),
    periodEnd: date("period_end").notNull(),
    ...compositionColumns,
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sec_filing_cache_series_idx").on(table.seriesId)],
);

/**
 * Fetched community tax-data updates (signed, kept as fetched to re-verify) and the admin's
 * decision; an approved file newer than the shipped one is applied after it on every start and
 * restore (`approvedCommunityFile`). Not household data: not versioned, backed up or reset.
 */
export const taxDataUpdates = pgTable("tax_data_updates", {
  dataVersion: integer("data_version").primaryKey(),
  fileText: text("file_text").notNull(),
  signature: text("signature").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  status: text("status").$type<TaxDataUpdateStatus>().notNull(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/** A SimpleFIN account's balance as reported, per balance date. */
export const simplefinAccountBalances = pgTable(
  "simplefin_account_balances",
  {
    id: serial("id").primaryKey(),
    simplefinAccountId: integer("simplefin_account_id")
      .notNull()
      .references(() => simplefinAccounts.id, { onDelete: "restrict" }),
    /** SimpleFIN `balance-date`, as sent (UTC). */
    balanceDate: timestamp("balance_date", { withTimezone: true }).notNull(),
    balance: decimal("balance", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("simplefin_account_balances_account_date_idx").on(
      table.simplefinAccountId,
      table.balanceDate,
    ),
  ],
);

/**
 * Shares held per SimpleFIN account and security, one row per report (`balanceDate`, or per
 * day with no report time); every report is kept. For funds with no public ticker, reported
 * value ÷ shares is the only price history.
 */
export const holdingObservations = pgTable(
  "holding_observations",
  {
    id: serial("id").primaryKey(),
    simplefinAccountId: integer("simplefin_account_id")
      .notNull()
      .references(() => simplefinAccounts.id, { onDelete: "restrict" }),
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "restrict" }),
    /** SimpleFIN `balance-date` as sent (UTC); null when the feed sent none. */
    balanceDate: timestamp("balance_date", { withTimezone: true }),
    /** The close assumed from balanceDate's time alone — no feed lag. The
     *  close the data really reflects is worked out on read
     *  (lib/pure/sync/feed-data-date.ts), since a feed's lag is learned. */
    asOf: date("as_of").notNull(),
    shares: decimal("shares", { precision: 20, scale: 8 }).notNull(),
    /** As reported — evidence only, never summed as a balance. */
    reportedMarketValue: decimal("reported_market_value", {
      precision: 14,
      scale: 2,
    }),
    avgCostPerShare: decimal("avg_cost_per_share", { precision: 20, scale: 8 }),
    source: text("source").$type<HoldingSource>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("holding_observations_simplefin_report_idx")
      .on(table.simplefinAccountId, table.securityId, table.balanceDate)
      .where(
        sql`${table.simplefinAccountId} IS NOT NULL AND ${table.balanceDate} IS NOT NULL`,
      ),
    uniqueIndex("holding_observations_simplefin_idx")
      .on(table.simplefinAccountId, table.securityId, table.asOf)
      .where(
        sql`${table.simplefinAccountId} IS NOT NULL AND ${table.balanceDate} IS NULL`,
      ),
    index("holding_observations_security_idx").on(table.securityId),
  ],
);

/**
 * Holdings of a tracked account over a date span with no SimpleFIN holdings, entered or inferred
 * (to confirm); observed periods derive from holding_observations. endDate null = still held.
 * Weights: holding_period_weights. The app also enforces the CHECKs (SQLite drops them).
 */
export const holdingPeriods = pgTable(
  "holding_periods",
  {
    id: serial("id").primaryKey(),
    // RESTRICT: entered history is costly to re-enter; deleting the
    // account is refused while it has periods (see performance.delete).
    performanceAccountId: integer("performance_account_id")
      .notNull()
      .references(() => performanceAccounts.id, { onDelete: "restrict" }),
    /** The part of the account (snapshotAccountKey) for an account whose
     *  feeds are linked per part; null = the whole account. */
    subKey: text("sub_key"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    basis: text("basis").$type<HoldingPeriodBasis>().notNull(),
    /** For an inferred period: how well it explains the account's returns (0–1). */
    fitQuality: decimal("fit_quality", { precision: 12, scale: 6 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("holding_periods_account_part_start_idx").on(
      table.performanceAccountId,
      table.subKey,
      table.startDate,
    ),
    check(
      "holding_periods_dates_check",
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
    // A part key names its own account (snapshotAccountKey starts "<id>_").
    check(
      "holding_periods_sub_key_check",
      sql`${table.subKey} IS NULL OR left(${table.subKey}, length(${table.performanceAccountId}::text) + 1) = ${table.performanceAccountId}::text || '_'`,
    ),
  ],
);

/** One fund's share of a holding period (weights of a period sum to 1). */
export const holdingPeriodWeights = pgTable(
  "holding_period_weights",
  {
    id: serial("id").primaryKey(),
    holdingPeriodId: integer("holding_period_id")
      .notNull()
      .references(() => holdingPeriods.id, { onDelete: "cascade" }),
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "restrict" }),
    weight: decimal("weight", { precision: 12, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex("holding_period_weights_period_security_idx").on(
      table.holdingPeriodId,
      table.securityId,
    ),
    index("holding_period_weights_security_idx").on(table.securityId),
    check(
      "holding_period_weights_range_check",
      sql`${table.weight} > 0 AND ${table.weight} <= 1`,
    ),
  ],
);

/**
 * Investment-account transactions as SimpleFIN sent them; the kind is computed on read, only an
 * override is stored. HSA medical descriptions are redacted at ingest, locking the kind.
 */
export const investmentTransactions = pgTable(
  "investment_transactions",
  {
    id: serial("id").primaryKey(),
    simplefinAccountId: integer("simplefin_account_id")
      .notNull()
      .references(() => simplefinAccounts.id, { onDelete: "restrict" }),
    /** SimpleFIN transaction id — unique only within its account. */
    externalId: text("external_id").notNull(),
    /** Institution posting date (UTC date of SimpleFIN `posted`). */
    posted: date("posted").notNull(),
    transacted: date("transacted"),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    description: text("description").notNull(),
    pending: boolean("pending").notNull().default(false),
    /**
     * Locked by ingest: HSA card spending stored as a "Medical withdrawal"
     * (merchant redacted). Null = the kind is worked out when read.
     */
    kindOverride: text("kind_override").$type<InvestmentTransactionKind>(),
    /** Set when the row vanished from a window that should still contain it. */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("investment_transactions_external_idx").on(
      table.simplefinAccountId,
      table.externalId,
    ),
    index("investment_transactions_account_posted_idx").on(
      table.simplefinAccountId,
      table.posted,
    ),
  ],
);

/** Outbound SimpleFIN request ledger — enforces the daily quota. Not versioned; pruned after 30 days. */
export const syncRequestLog = pgTable(
  "sync_request_log",
  {
    id: serial("id").primaryKey(),
    service: text("service").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endpoint: text("endpoint").notNull(),
    httpStatus: integer("http_status"),
    outcome: text("outcome").notNull(),
  },
  (table) => [
    index("sync_request_log_service_requested_idx").on(
      table.service,
      table.requestedAt,
    ),
  ],
);

export const simplefinAccounts = pgTable(
  "simplefin_accounts",
  {
    id: serial("id").primaryKey(),
    externalAccountId: text("external_account_id").notNull().unique(),
    orgName: text("org_name").notNull(),
    accountName: text("account_name").notNull(),
    lastBalance: decimal("last_balance", {
      precision: 14,
      scale: 2,
    }).notNull(),
    /** The institution's as-of time for lastBalance (SimpleFIN `balance-date`); null when not reported. */
    lastBalanceDate: timestamp("last_balance_date", { withTimezone: true }),
    isIncluded: boolean("is_included").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    linkedPerformanceAccountId: integer(
      "linked_performance_account_id",
    ).references(() => performanceAccounts.id, { onDelete: "set null" }),
    /**
     * The sub-account (snapshotAccountKey) this feed is, or null for the whole tracked account.
     * Needs linkedPerformanceAccountId (router-enforced, not a CHECK, so deleting the tracked
     * account isn't blocked by a leftover key; readers ignore one).
     */
    linkedSubKey: text("linked_sub_key"),
    /**
     * The mortgage loan this feed reports; its balance becomes the loan's while included. One
     * feed per loan, never also linkedPerformanceAccountId (router-enforced).
     */
    linkedLoanId: integer("linked_loan_id").references(() => mortgageLoans.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("simplefin_accounts_org_name_idx").on(
      table.orgName,
      table.accountName,
    ),
    index("simplefin_accounts_linked_perf_account_idx").on(
      table.linkedPerformanceAccountId,
    ),
    uniqueIndex("simplefin_accounts_linked_loan_idx").on(table.linkedLoanId),
  ],
);
