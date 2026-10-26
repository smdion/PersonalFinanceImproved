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
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
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

export const apiConnections = pgTable(
  "api_connections",
  {
    id: serial("id").primaryKey(),
    service: text("service").notNull().unique(),
    config: jsonb("config").$type<ApiConfig>().notNull(),
    accountMappings: jsonb("account_mappings").$type<AccountMapping[]>(),
    skippedCategoryIds: jsonb("skipped_category_ids").$type<string[]>(),
    // References budgetProfiles.id — no DB-level FK constraint. Always
    // resolved via allProfiles.find(p => p.id === conn.linkedProfileId) in
    // server code (budget.ts, sync/core.ts); despite the generic name it
    // is never polymorphic across other tables.
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
export const projectionCache = pgTable(
  "projection_cache",
  {
    id: serial("id").primaryKey(),
    /** sha256 of the canonicalized engine input this row was computed
     *  from — see hashEngineInput in server/helpers/projection-cache.ts.
     *  Different per procedure (deterministic vs MC vs Coast-FIRE MC
     *  inputs differ), so the kind is folded into the hash input itself
     *  rather than a separate column. */
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

// ── Investments data foundation (v0.8.5) ─────────────────────────────────
// What SimpleFIN only keeps for 90 days (holdings, transactions) is stored
// here as sent. Transaction classification is NOT stored — it is computed on
// read by lib/pure/simplefin-transactions.ts from these inputs plus the
// built-in and user rules, so a rule change re-classifies history (RULES:
// computed values are not stored). Only explicit overrides are stored.

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
    /** What a suggested (not yet confirmed) stand-in's SEC filings say,
     *  so the household can judge it before using it: how much of the fund
     *  they explain, its mix, and its cheapest share class's fee. Never
     *  counted as this fund's facts. */
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
 * Dated facts about a fund: its expense ratio and what it holds. From SEC
 * filings (its own, or a confirmed stand-in's) or entered by the
 * household. Read as groups — expense ratio and composition each come
 * whole from one row, never mixed across filings.
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
 * Community tax-data updates this install has fetched (signed releases of
 * the tax-data file between Ledgr versions) and what an admin decided.
 * The file is kept as fetched, with its signature, so it can be verified
 * again before applying; the figures it would change are worked out on
 * demand against the current rows, never stored. An approved file newer
 * than the shipped one is applied after it on every start and restore
 * (reference-data.ts `approvedCommunityFile`). Not household data: not
 * versioned, backed up or reset.
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
 * Shares held per account, security and trading day. One row per day: for
 * funds with no public ticker, the reported value ÷ shares is the only price
 * history there is. Exactly one of simplefinAccountId / performanceAccountId
 * is set (enforced in the app layer too — SQLite drops CHECK constraints).
 */
export const holdingObservations = pgTable(
  "holding_observations",
  {
    id: serial("id").primaryKey(),
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
    balanceDate: timestamp("balance_date", { withTimezone: true }),
    /** Valuation date: the most recent completed US trading day for balanceDate. */
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
    check(
      "holding_observations_one_account_check",
      sql`(${table.simplefinAccountId} IS NULL) <> (${table.performanceAccountId} IS NULL)`,
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
 * Investment-account transactions exactly as SimpleFIN sent them. The kind
 * (contribution, fee, …) is computed on read; only an explicit override is
 * stored. HSA medical-spending descriptions are redacted at ingest, which
 * locks the kind (kindOverrideSource = ingest_redacted).
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
