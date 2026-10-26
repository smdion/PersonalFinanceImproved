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
  BudgetApiService,
  InvestmentTransactionKind,
  SecurityKind,
  SecurityFactSource,
  FactsBasis,
  HoldingSource,
  HoldingPeriodBasis,
  StandInPreview,
  TaxDataUpdateStatus,
} from "@/lib/config/enum-values";
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
    // References budgetProfiles.id — no DB-level FK constraint. Always
    // resolved via allProfiles.find(p => p.id === conn.linkedProfileId) in
    // server code (budget.ts, sync/core.ts); despite the generic name it
    // is never polymorphic across other tables.
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
 * Server-side cache for retirement projection results (deterministic
 * engine + Monte Carlo + Coast FIRE MC) — a new table rather than reusing
 * budgetApiCache. That table's `service` column is the argument to a
 * DESTRUCTIVE operation (cacheClear drops-and-repulls a remote budget-API
 * mirror); a projection cache has no upstream to re-pull from, and
 * `serverKnowledge` (a YNAB delta-sync cursor) has no equivalent here. Its
 * keyspace is also small and bounded ("categories", "months/YYYY-MM-01");
 * this one is a hash per distinct input combination, unbounded, so it
 * needs its own eviction (expiresAt + lastReadAt), which budgetApiCache's
 * helpers don't provide.
 *
 * `seed` is stored WITH the cached result, not as a separate persisted
 * setting: on a cache miss a fresh random seed is generated and stored
 * alongside the result; on a hit, the ALREADY-STORED seed is what
 * determined that stored result, so returning it is honestly
 * reproducible — "this exact run really would produce this answer" —
 * rather than silently freezing a stochastic simulation's randomness
 * under a key that implies full determinism. A cache MISS (new inputs)
 * always gets a new seed; "Re-run simulation" forces a miss.
 */
export const projectionCache = sqliteTable(
  "projection_cache",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    /** sha256 of the canonicalized engine input this row was computed
     *  from — see hashEngineInput in server/helpers/projection-cache.ts.
     *  Different per procedure (deterministic vs MC vs Coast-FIRE MC
     *  inputs differ), so the kind is folded into the hash input itself
     *  rather than a separate column. */
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
    /** Bumped whenever the engine's computation logic changes in a way
     *  that could change output for the same inputs — auto-invalidates
     *  stale-shaped/stale-computed rows after a deploy without needing a
     *  manual cache-clear. See PROJECTION_CACHE_ENGINE_VERSION. */
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
    totalBalance: text("total_balance").notNull(),
    accountCount: integer("account_count").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("simplefin_balance_snapshots_date_idx").on(table.snapshotDate),
  ],
);

// ── Investments data foundation (v0.8.5) ─────────────────────────────────
// What SimpleFIN only keeps for 90 days (holdings, transactions) is stored
// here as sent. Transaction classification is NOT stored — it is computed on
// read by lib/pure/simplefin-transactions.ts from these inputs plus the
// built-in and user rules, so a rule change re-classifies history (RULES:
// computed values are not stored). Only explicit overrides are stored.

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
    /** What a suggested (not yet confirmed) stand-in's SEC filings say,
     *  so the household can judge it before using it: how much of the fund
     *  they explain, its mix, and its cheapest share class's fee. Never
     *  counted as this fund's facts. */
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
  usEquityPct: text("us_equity_pct"),
  intlEquityPct: text("intl_equity_pct"),
  usBondPct: text("us_bond_pct"),
  intlBondPct: text("intl_bond_pct"),
  tipsPct: text("tips_pct"),
  cashPct: text("cash_pct"),
  otherPct: text("other_pct"),
  /** Share of the fund's holdings that could be classified (the rest is unresolved). */
  coverage: text("coverage"),
};

/**
 * Dated facts about a fund: its expense ratio and what it holds. From SEC
 * filings (its own, or a confirmed stand-in's) or entered by the
 * household. Read as groups — expense ratio and composition each come
 * whole from one row, never mixed across filings.
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
    expenseRatio: text("expense_ratio"),
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
 * Community tax-data updates this install has fetched (signed releases of
 * the tax-data file between Ledgr versions) and what an admin decided.
 * The file is kept as fetched, with its signature, so it can be verified
 * again before applying; the figures it would change are worked out on
 * demand against the current rows, never stored. An approved file newer
 * than the shipped one is applied after it on every start and restore
 * (reference-data.ts `approvedCommunityFile`). Not household data: not
 * versioned, backed up or reset.
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
    balance: text("balance").notNull(),
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
 * Shares held per account, security and trading day. One row per day: for
 * funds with no public ticker, the reported value ÷ shares is the only price
 * history there is. Exactly one of simplefinAccountId / performanceAccountId
 * is set (enforced in the app layer too — SQLite drops CHECK constraints).
 */
export const holdingObservations = sqliteTable(
  "holding_observations",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    simplefinAccountId: integer("simplefin_account_id").references(
      () => simplefinAccounts.id,
      { onDelete: "restrict" },
    ),
    performanceAccountId: integer("performance_account_id").references(
      () => performanceAccounts.id,
      { onDelete: "restrict" },
    ),
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "restrict" }),
    /** SimpleFIN `balance-date` as sent (UTC); null for manual rows. */
    balanceDate: integer("balance_date", { mode: "timestamp" }),
    /** Valuation date: the most recent completed US trading day for balanceDate. */
    asOf: text("as_of").notNull(),
    shares: text("shares").notNull(),
    /** As reported — evidence only, never summed as a balance. */
    reportedMarketValue: text("reported_market_value"),
    avgCostPerShare: text("avg_cost_per_share"),
    source: text("source").$type<HoldingSource>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("holding_observations_simplefin_idx")
      .on(table.simplefinAccountId, table.securityId, table.asOf)
      .where(sql`${table.simplefinAccountId} IS NOT NULL`),
    uniqueIndex("holding_observations_manual_idx")
      .on(table.performanceAccountId, table.securityId, table.asOf)
      .where(sql`${table.performanceAccountId} IS NOT NULL`),
    index("holding_observations_security_idx").on(table.securityId),
    index("holding_observations_perf_account_idx").on(
      table.performanceAccountId,
    ),
  ],
);

/**
 * What a tracked account held over a span of dates, before daily SimpleFIN
 * holdings existed (or for an account with no feed): entered by the
 * household or inferred (a proposal to confirm). Observed periods are NOT
 * stored here — they're derived from holding_observations on read (one
 * source of truth). endDate null = still held. Weights live in
 * holding_period_weights. CHECKs are enforced in the app layer too —
 * SQLite drops CHECK constraints.
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
    fitQuality: text("fit_quality"),
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
    weight: text("weight").notNull(),
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
 * Investment-account transactions exactly as SimpleFIN sent them. The kind
 * (contribution, fee, …) is computed on read; only an explicit override is
 * stored. HSA medical-spending descriptions are redacted at ingest, which
 * locks the kind (kindOverrideSource = ingest_redacted).
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
    amount: text("amount").notNull(),
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
    lastBalance: text("last_balance").notNull(),
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
     * The sub-account this SimpleFIN account is (snapshotAccountKey: tracked
     * account + tax type + kind + owner), or null for the whole tracked
     * account. Institutions report sub-accounts separately — e.g. each
     * spouse's Roth IRA inside one joint "IRA" tracked account.
     * Only meaningful with linkedPerformanceAccountId (enforced by the
     * router, not a CHECK: deleting a tracked account nulls the link and
     * must not be blocked by a leftover key, which readers ignore).
     */
    linkedSubKey: text("linked_sub_key"),
  },
  (table) => [
    index("simplefin_accounts_org_name_idx").on(
      table.orgName,
      table.accountName,
    ),
    index("simplefin_accounts_linked_perf_account_idx").on(
      table.linkedPerformanceAccountId,
    ),
  ],
);
