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
import { decimalText } from "../sqlite-decimal";

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

export const apiConnections = sqliteTable(
  "api_connections",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    service: text("service").notNull().unique(),
    config: text("config", { mode: "json" }).$type<ApiConfig>().notNull(),
    accountMappings: text("account_mappings", { mode: "json" }).$type<
      AccountMapping[]
    >(),
    skippedCategoryIds: text("skipped_category_ids", { mode: "json" }).$type<
      string[]
    >(),
    // A budgetProfiles.id (no DB-level FK), looked up in server code; never an id
    // from another table despite the generic name.
    linkedProfileId: integer("linked_profile_id"),
    linkedColumnIndex: integer("linked_column_index"),
    serverKnowledge: integer("server_knowledge"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  },
  (table) => [
    index("api_connections_linked_profile_id_idx").on(table.linkedProfileId),
  ],
);

export const budgetApiCache = sqliteTable(
  "budget_api_cache",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    service: text("service").$type<BudgetApiService>().notNull(),
    cacheKey: text("cache_key").notNull(),
    data: text("data", { mode: "json" }).$type<unknown>().notNull(),
    serverKnowledge: integer("server_knowledge"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
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
export const projectionCache = sqliteTable(
  "projection_cache",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    /** sha256 of the canonical engine input (hashEngineInput in projection-cache.ts); the
     *  procedure kind is folded into the hashed input, not a separate column. */
    inputHash: text("input_hash").notNull(),
    /** Random seed used for this computation — null for the deterministic
     *  engine result, which has no randomness to seed. */
    seed: integer("seed"),
    result: text("result", { mode: "json" }).$type<unknown>().notNull(),
    computedAt: integer("computed_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    lastReadAt: integer("last_read_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
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

export const simplefinBalanceSnapshots = sqliteTable(
  "simplefin_balance_snapshots",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    snapshotDate: text("snapshot_date").notNull().unique(),
    totalBalance: decimalText("total_balance").notNull(),
    accountCount: integer("account_count").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
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
export const marketCloses = sqliteTable(
  "market_closes",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    ticker: text("ticker").notNull(),
    date: text("date").notNull(),
    close: decimalText("close").notNull(),
    divCash: decimalText("div_cash").notNull().default("0"),
    splitFactor: decimalText("split_factor").notNull().default("1"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("market_closes_ticker_date_idx").on(table.ticker, table.date),
  ],
);

/** A fund/security as an institution reports it. */
export const securities = sqliteTable(
  "securities",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
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
    standinConfirmedAt: integer("standin_confirmed_at", { mode: "timestamp" }),
    /** What a suggested (unconfirmed) stand-in's SEC filings say (coverage, mix, cheapest share
     *  class's fee) for the household to judge; never counted as this fund's facts. */
    standinPreview: text("standin_preview", {
      mode: "json",
    }).$type<StandInPreview>(),
    /** Last time SEC was checked for new filings (whether or not anything changed). */
    factsCheckedAt: integer("facts_checked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
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
  usEquityPct: decimalText("us_equity_pct"),
  intlEquityPct: decimalText("intl_equity_pct"),
  usBondPct: decimalText("us_bond_pct"),
  intlBondPct: decimalText("intl_bond_pct"),
  tipsPct: decimalText("tips_pct"),
  cashPct: decimalText("cash_pct"),
  otherPct: decimalText("other_pct"),
  /** Share of the fund's holdings that could be classified (the rest is unresolved). */
  coverage: decimalText("coverage"),
};

/**
 * Dated fund facts (expense ratio, holdings) from SEC filings (its own or a confirmed
 * stand-in's) or the household. Expense ratio and composition each come whole from one row.
 */
export const securityFacts = sqliteTable(
  "security_facts",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "restrict" }),
    /** Period the facts describe (filing period end), or the day the user entered them. */
    asOf: text("as_of").notNull(),
    source: text("source").$type<SecurityFactSource>().notNull(),
    /** Series the filing belongs to — differs from the fund's own when a stand-in supplied it. */
    secSeriesId: text("sec_series_id"),
    accession: text("accession"),
    /** Annual expense ratio as a fraction (0.0008 = 0.08%). */
    expenseRatio: decimalText("expense_ratio"),
    ...compositionColumns,
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("security_facts_identity_idx").on(
      table.securityId,
      table.source,
      table.asOf,
    ),
    index("security_facts_security_idx").on(table.securityId),
  ],
);

/**
 * Normalised composition of any fund's N-PORT filing, by accession — so a
 * look-through into the same underlying fund isn't downloaded twice.
 * Re-fetchable: not versioned or backed up.
 */
export const secFilingCache = sqliteTable(
  "sec_filing_cache",
  {
    accession: text("accession").primaryKey(),
    seriesId: text("series_id").notNull(),
    periodEnd: text("period_end").notNull(),
    ...compositionColumns,
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index("sec_filing_cache_series_idx").on(table.seriesId)],
);

/**
 * Fetched community tax-data updates (signed, kept as fetched to re-verify) and the admin's
 * decision; an approved file newer than the shipped one is applied after it on every start and
 * restore (`approvedCommunityFile`). Not household data: not versioned, backed up or reset.
 */
export const taxDataUpdates = sqliteTable("tax_data_updates", {
  dataVersion: integer("data_version").primaryKey(),
  fileText: text("file_text").notNull(),
  signature: text("signature").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  status: text("status").$type<TaxDataUpdateStatus>().notNull(),
  decidedBy: text("decided_by"),
  decidedAt: integer("decided_at", { mode: "timestamp" }),
});

/** A SimpleFIN account's balance as reported, per balance date. */
export const simplefinAccountBalances = sqliteTable(
  "simplefin_account_balances",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    simplefinAccountId: integer("simplefin_account_id")
      .notNull()
      .references(() => simplefinAccounts.id, { onDelete: "restrict" }),
    /** SimpleFIN `balance-date`, as sent (UTC). */
    balanceDate: integer("balance_date", { mode: "timestamp" }).notNull(),
    balance: decimalText("balance").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
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
export const holdingObservations = sqliteTable(
  "holding_observations",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    simplefinAccountId: integer("simplefin_account_id")
      .notNull()
      .references(() => simplefinAccounts.id, { onDelete: "restrict" }),
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "restrict" }),
    /** SimpleFIN `balance-date` as sent (UTC); null when the feed sent none. */
    balanceDate: integer("balance_date", { mode: "timestamp" }),
    /** The close assumed from balanceDate's time alone — no feed lag. The
     *  close the data really reflects is worked out on read
     *  (lib/pure/sync/feed-data-date.ts), since a feed's lag is learned. */
    asOf: text("as_of").notNull(),
    shares: decimalText("shares").notNull(),
    /** As reported — evidence only, never summed as a balance. */
    reportedMarketValue: decimalText("reported_market_value"),
    avgCostPerShare: decimalText("avg_cost_per_share"),
    source: text("source").$type<HoldingSource>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
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
export const holdingPeriods = sqliteTable(
  "holding_periods",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    // RESTRICT: entered history is costly to re-enter; deleting the
    // account is refused while it has periods (see performance.delete).
    performanceAccountId: integer("performance_account_id")
      .notNull()
      .references(() => performanceAccounts.id, { onDelete: "restrict" }),
    /** The part of the account (snapshotAccountKey) for an account whose
     *  feeds are linked per part; null = the whole account. */
    subKey: text("sub_key"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    basis: text("basis").$type<HoldingPeriodBasis>().notNull(),
    /** For an inferred period: how well it explains the account's returns (0–1). */
    fitQuality: decimalText("fit_quality"),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("holding_periods_account_part_start_idx").on(
      table.performanceAccountId,
      table.subKey,
      table.startDate,
    ),
    // A part key names its own account (snapshotAccountKey starts "<id>_").
  ],
);

/** One fund's share of a holding period (weights of a period sum to 1). */
export const holdingPeriodWeights = sqliteTable(
  "holding_period_weights",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    holdingPeriodId: integer("holding_period_id")
      .notNull()
      .references(() => holdingPeriods.id, { onDelete: "cascade" }),
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "restrict" }),
    weight: decimalText("weight").notNull(),
  },
  (table) => [
    uniqueIndex("holding_period_weights_period_security_idx").on(
      table.holdingPeriodId,
      table.securityId,
    ),
    index("holding_period_weights_security_idx").on(table.securityId),
  ],
);

/**
 * Investment-account transactions as SimpleFIN sent them; the kind is computed on read, only an
 * override is stored. HSA medical descriptions are redacted at ingest, locking the kind.
 */
export const investmentTransactions = sqliteTable(
  "investment_transactions",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    simplefinAccountId: integer("simplefin_account_id")
      .notNull()
      .references(() => simplefinAccounts.id, { onDelete: "restrict" }),
    /** SimpleFIN transaction id — unique only within its account. */
    externalId: text("external_id").notNull(),
    /** Institution posting date (UTC date of SimpleFIN `posted`). */
    posted: text("posted").notNull(),
    transacted: text("transacted"),
    amount: decimalText("amount").notNull(),
    description: text("description").notNull(),
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
    /**
     * Locked by ingest: HSA card spending stored as a "Medical withdrawal"
     * (merchant redacted). Null = the kind is worked out when read.
     */
    kindOverride: text("kind_override").$type<InvestmentTransactionKind>(),
    /** Set when the row vanished from a window that should still contain it. */
    voidedAt: integer("voided_at", { mode: "timestamp" }),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
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
export const syncRequestLog = sqliteTable(
  "sync_request_log",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    service: text("service").notNull(),
    requestedAt: integer("requested_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
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

export const simplefinAccounts = sqliteTable(
  "simplefin_accounts",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    externalAccountId: text("external_account_id").notNull().unique(),
    orgName: text("org_name").notNull(),
    accountName: text("account_name").notNull(),
    lastBalance: decimalText("last_balance").notNull(),
    /** The institution's as-of time for lastBalance (SimpleFIN `balance-date`); null when not reported. */
    lastBalanceDate: integer("last_balance_date", { mode: "timestamp" }),
    isIncluded: integer("is_included", { mode: "boolean" })
      .notNull()
      .default(true),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
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
