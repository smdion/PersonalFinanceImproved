// Shared SimpleFIN sync logic — the single code path for pulling balances
// and writing a daily snapshot. Called by both the CRON_SECRET-guarded
// daily route (src/app/api/simplefin/daily/route.ts) and the "Sync Now"
// tRPC mutation, so both behave identically (single computation path).
//
// Deliberately does NOT go through lib/budget-api/factory.ts's
// getApiConnection/getClientForService — those are hard-typed to
// "ynab" | "actual" and reserved for the BudgetAPIClient contract.
// SimpleFIN is a parallel, read-only balance integration with no
// transaction/category/budget concepts, so it queries api_connections
// directly instead of widening that union.

import "server-only";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { encryptJson, readMaybeEncrypted } from "@/lib/crypto";
import {
  getAccounts,
  isSimplefinReplayMode,
  type SimplefinAccount,
} from "./client";
import { BudgetApiError } from "@/lib/budget-api/errors";
import {
  SIMPLEFIN_DAILY_REQUEST_LIMIT,
  countSimplefinRequestsLastDay,
  pruneSimplefinRequestLog,
  recordSimplefinRequest,
} from "./request-log";
import { ingestInvestmentData, type IngestSummary } from "./ingest";
import { utcDayOf } from "@/lib/utils/date";
import { localDateStr } from "@/lib/utils/date";

export { localDateStr };

type Db = typeof import("@/lib/db").db;

export type SimplefinConfig = {
  accessUrl: string;
};

export type SimplefinSyncResult = {
  snapshotDate: string;
  totalBalance: number;
  accountCount: number;
  /** Non-fatal provider errors from this sync (e.g. one institution needs re-auth), for the UI to surface. */
  providerErrors: string[];
  /** What was stored for investment accounts (holdings, transactions); absent for local recomputes. */
  investments?: Omit<IngestSummary, "warnings">;
};

/** Re-request this many days before the last successful sync so late-posting rows are caught. */
const WINDOW_OVERLAP_DAYS = 5;
/** SimpleFIN keeps about 90 days of transactions. */
/**
 * SimpleFIN keeps 90 days of transactions and answers a request for more
 * than that with a "capped" notice — and an exact 90 can already exceed it
 * by the time the provider evaluates it. Ask for a day less; if the
 * provider ever reports a smaller limit, use that instead (learned, see
 * getWindowLimitDays).
 */
const DEFAULT_MAX_WINDOW_DAYS = 89;
const WINDOW_LIMIT_KEY = "simplefin_window_limit_days";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the transaction window to request: last success minus the overlap, at most 90 days back. */
export function transactionWindowStart(
  lastSyncedAt: Date | null,
  now: Date,
  maxDays: number = DEFAULT_MAX_WINDOW_DAYS,
): Date {
  const earliest = now.getTime() - maxDays * DAY_MS;
  if (!lastSyncedAt) return new Date(earliest);
  return new Date(
    Math.max(earliest, lastSyncedAt.getTime() - WINDOW_OVERLAP_DAYS * DAY_MS),
  );
}

const LAST_ERROR_SETTING_KEY = "simplefin_last_error";
const PARTIAL_SYNC_STATE_KEY = "simplefin_partial_sync_state";
/** Cap same-day retries for a partial sync (an account silently missing from
 *  SimpleFIN's response, no explicit error) — an account that's genuinely
 *  broken (needs re-auth the user hasn't done yet) would otherwise get
 *  retried every hourly cron tick, burning the whole ~24/day quota chasing
 *  something a retry can't fix. After this many same-day attempts, give up
 *  and mark the connection synced (stop retrying today) but keep the
 *  warning visible. */
export const MAX_PARTIAL_SYNC_RETRIES_PER_DAY = 3;

const INVESTMENTS_SYNCED_AT_KEY = "simplefin_investments_synced_at";
const INVESTMENTS_FIRST_SYNCED_AT_KEY = "simplefin_investments_first_synced_at";

/** When holdings and transactions were last stored completely, or null if never. */
export async function getInvestmentsSyncedAt(db: Db): Promise<Date | null> {
  const rows = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, INVESTMENTS_SYNCED_AT_KEY));
  const value = rows[0]?.value;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function setInvestmentsSyncedAt(db: Db, at: Date): Promise<void> {
  await db
    .insert(schema.appSettings)
    .values({ key: INVESTMENTS_SYNCED_AT_KEY, value: at.toISOString() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: at.toISOString() },
    });
  // The first complete ingest fixes how far back stored transactions reach.
  await db
    .insert(schema.appSettings)
    .values({ key: INVESTMENTS_FIRST_SYNCED_AT_KEY, value: at.toISOString() })
    .onConflictDoNothing();
}

/**
 * The earliest day stored transactions are complete from: SimpleFIN's
 * 90-day window before the first complete ingest. Null before any ingest.
 */
export async function getTransactionCoverageStart(
  db: Db,
): Promise<Date | null> {
  const rows = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, INVESTMENTS_FIRST_SYNCED_AT_KEY));
  const value = rows[0]?.value;
  if (typeof value !== "string") return null;
  const first = new Date(value);
  if (Number.isNaN(first.getTime())) return null;
  return transactionWindowStart(null, first, await getWindowLimitDays(db));
}

/** How many days of history to request: the default, or less if the provider said its limit is lower. */
export async function getWindowLimitDays(db: Db): Promise<number> {
  const rows = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, WINDOW_LIMIT_KEY));
  const stored = Number(rows[0]?.value);
  return Number.isFinite(stored) && stored > 0
    ? Math.min(DEFAULT_MAX_WINDOW_DAYS, stored)
    : DEFAULT_MAX_WINDOW_DAYS;
}

/** Remember a lower limit the provider reported (one day inside it, like the default). */
async function learnWindowLimit(db: Db, reportedDays: number): Promise<void> {
  const learned = Math.max(1, reportedDays - 1);
  if (learned >= (await getWindowLimitDays(db))) return;
  await db
    .insert(schema.appSettings)
    .values({ key: WINDOW_LIMIT_KEY, value: learned })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: learned },
    });
}

/** Get the api_connections row for the simplefin service, or null if not configured. */
export async function getSimplefinConnection(db: Db) {
  const rows = await db
    .select()
    .from(schema.apiConnections)
    .where(eq(schema.apiConnections.service, "simplefin"))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * True if the SimpleFIN connection's lastSyncedAt already falls on
 * `asOfDate`'s local calendar day — the daily cron uses this to skip
 * calling the external API a second time today. Deliberately reads
 * api_connections.lastSyncedAt (set only by a real runSimplefinSync API
 * call) rather than simplefin_balance_snapshots (also written by the
 * zero-API-cost recomputeTodaySnapshotFromLocal path, which would make
 * this guard skip the real sync on any day a user merely toggles an
 * account's inclusion).
 */
export async function hasSyncedToday(
  db: Db,
  asOfDate: Date = new Date(),
): Promise<boolean> {
  const conn = await getSimplefinConnection(db);
  if (!conn?.lastSyncedAt) return false;
  return localDateStr(conn.lastSyncedAt) === localDateStr(asOfDate);
}

/** Record (or clear) the last SimpleFIN sync error for display in the UI. */
async function setSimplefinLastError(db: Db, message: string | null) {
  if (message == null) {
    await db
      .delete(schema.appSettings)
      .where(eq(schema.appSettings.key, LAST_ERROR_SETTING_KEY));
    return;
  }
  await db
    .insert(schema.appSettings)
    .values({ key: LAST_ERROR_SETTING_KEY, value: message })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: message },
    });
}

/** Read the last recorded SimpleFIN sync error, if any. */
export async function getSimplefinLastError(db: Db): Promise<string | null> {
  const rows = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, LAST_ERROR_SETTING_KEY))
    .limit(1);
  return (rows[0]?.value as string | undefined) ?? null;
}

type PartialSyncState = { date: string; attempts: number };

/** Increment (or start) today's partial-sync retry counter, returning the
 *  new attempt count for today. Resets to 1 whenever the stored date isn't
 *  today's local date. */
async function bumpPartialSyncAttempts(
  db: Db,
  asOfDate: Date,
): Promise<number> {
  const today = localDateStr(asOfDate);
  const rows = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, PARTIAL_SYNC_STATE_KEY))
    .limit(1);
  const prev = (rows[0]?.value as PartialSyncState | undefined) ?? null;
  const attempts = prev && prev.date === today ? prev.attempts + 1 : 1;
  const next: PartialSyncState = { date: today, attempts };
  await db
    .insert(schema.appSettings)
    .values({ key: PARTIAL_SYNC_STATE_KEY, value: next })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: next },
    });
  return attempts;
}

/** Clear the partial-sync retry counter — called on a fully-successful sync. */
async function clearPartialSyncAttempts(db: Db): Promise<void> {
  await db
    .delete(schema.appSettings)
    .where(eq(schema.appSettings.key, PARTIAL_SYNC_STATE_KEY));
}

/** Store (upsert) the SimpleFIN access URL, encrypted at rest. */
export async function saveSimplefinConnection(db: Db, accessUrl: string) {
  const config = encryptJson({ accessUrl } satisfies SimplefinConfig);
  // eslint-disable-next-line no-restricted-syntax -- encrypted envelope stored in the generic ApiConfig jsonb column, same pattern as saveConnection() in sync/connections.ts
  const storedConfig = config as unknown as schema.ApiConfig;
  await db
    .insert(schema.apiConnections)
    .values({ service: "simplefin", config: storedConfig })
    .onConflictDoUpdate({
      target: schema.apiConnections.service,
      set: { config: storedConfig },
    });
}

export async function removeSimplefinConnection(db: Db) {
  await db
    .delete(schema.apiConnections)
    .where(eq(schema.apiConnections.service, "simplefin"));
}

export type SimplefinAccountRow = {
  id: number;
  externalAccountId: string;
  orgName: string;
  accountName: string;
  lastBalance: number;
  /** The institution's as-of time for lastBalance; null when not reported. */
  lastBalanceDate: Date | null;
  isIncluded: boolean;
  lastSeenAt: Date;
};

/**
 * Upsert every fetched account by its stable externalAccountId. The update
 * branch deliberately omits `isIncluded` from `set` so a user's manual
 * toggle survives future syncs; the insert branch relies on the column's
 * schema default (true) so a brand-new account starts out included.
 * Returns each row's full resulting state (via RETURNING), which is how
 * callers learn the current isIncluded flag for accounts they didn't
 * explicitly toggle themselves.
 */
export async function upsertSimplefinAccounts(
  db: Db,
  accounts: SimplefinAccount[],
): Promise<SimplefinAccountRow[]> {
  if (accounts.length === 0) return [];
  const now = new Date();
  // Postgres rejects a multi-row ON CONFLICT DO UPDATE batch if the same
  // conflict target appears twice ("cannot affect row a second time") —
  // dedupe defensively so a provider response with a repeated account id
  // can't crash the whole sync. Keep the last occurrence (most current).
  const deduped = [...new Map(accounts.map((a) => [a.id, a])).values()];
  const rows = await db
    .insert(schema.simplefinAccounts)
    .values(
      deduped.map((a) => ({
        externalAccountId: a.id,
        orgName: a.orgName,
        accountName: a.name,
        lastBalance: a.balance.toFixed(2),
        // Paired with lastBalance: null when not reported, never an older date.
        lastBalanceDate: a.balanceDate ?? null,
        lastSeenAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: schema.simplefinAccounts.externalAccountId,
      set: {
        orgName: sql`excluded.org_name`,
        accountName: sql`excluded.account_name`,
        lastBalance: sql`excluded.last_balance`,
        lastBalanceDate: sql`excluded.last_balance_date`,
        lastSeenAt: sql`excluded.last_seen_at`,
      },
    })
    .returning();
  // Drizzle returns decimal columns as strings — convert before any caller sums lastBalance.
  return rows.map((r) => ({
    id: r.id,
    externalAccountId: r.externalAccountId,
    orgName: r.orgName,
    accountName: r.accountName,
    lastBalance: Number(r.lastBalance),
    lastBalanceDate: r.lastBalanceDate,
    isIncluded: r.isIncluded,
    lastSeenAt: r.lastSeenAt,
  }));
}

/** Upsert today's simplefin_balance_snapshots row — the single write path shared by every sync/recompute flow. */
async function writeSnapshot(
  db: Db,
  snapshotDate: string,
  totalBalance: number,
  accountCount: number,
) {
  await db
    .insert(schema.simplefinBalanceSnapshots)
    .values({
      snapshotDate,
      totalBalance: totalBalance.toFixed(2),
      accountCount,
    })
    .onConflictDoUpdate({
      target: schema.simplefinBalanceSnapshots.snapshotDate,
      set: { totalBalance: totalBalance.toFixed(2), accountCount },
    });
}

/**
 * Pull current balances from SimpleFIN, upsert the account registry, and
 * upsert today's snapshot row from only the accounts currently marked
 * included. Upserting the snapshot on snapshotDate (rather than
 * skip-if-exists) means calling this multiple times in one day — cron
 * plus a manual "Sync Now" — is safe and keeps the snapshot current,
 * without ever creating a duplicate row for the same day.
 *
 * If SimpleFIN's response silently omits a previously-included account (no
 * explicit error, just missing from the list), that's treated as a partial
 * sync: today's snapshot still reflects whatever DID come back (mixed with
 * the missing account's last-known balance), a warning is surfaced via
 * getSimplefinLastError, and `lastSyncedAt` is deliberately NOT advanced —
 * so hasSyncedToday() stays false and the next hourly cron tick retries,
 * instead of the connection looking fully synced while one account is
 * silently stuck. Capped at MAX_PARTIAL_SYNC_RETRIES_PER_DAY same-day
 * attempts to protect the ~24/day quota from a permanently-broken account.
 *
 * Throws if no SimpleFIN connection is configured — callers (cron route,
 * tRPC mutation) are responsible for translating that into a skip/error
 * response appropriate to their context.
 */
export async function runSimplefinSync(
  db: Db,
  asOfDate: Date = new Date(),
): Promise<SimplefinSyncResult> {
  const conn = await getSimplefinConnection(db);
  if (!conn) {
    throw new Error("No SimpleFIN connection configured");
  }

  try {
    const { accessUrl } = readMaybeEncrypted<SimplefinConfig>(conn.config);

    // Snapshot which included accounts we expect BEFORE fetching, so a
    // silent partial response (an account missing from SimpleFIN's
    // `accounts` array with no explicit error — the provider doesn't have
    // to signal a degraded response) can be detected instead of looking
    // identical to a full success. upsertSimplefinAccounts only touches
    // rows present in the fetch, so a missing account's row is silently
    // never updated unless we check for it here.
    const expectedIncluded = await db
      .select({
        externalAccountId: schema.simplefinAccounts.externalAccountId,
        orgName: schema.simplefinAccounts.orgName,
        accountName: schema.simplefinAccounts.accountName,
      })
      .from(schema.simplefinAccounts)
      .where(eq(schema.simplefinAccounts.isIncluded, true));

    // Quota: every real request counts against SimpleFIN Bridge's daily
    // limit (exceeding it can disable the connection). Replays don't count.
    const replay = isSimplefinReplayMode();
    await pruneSimplefinRequestLog(db, asOfDate);
    if (!replay) {
      const used = await countSimplefinRequestsLastDay(db, asOfDate);
      if (used >= SIMPLEFIN_DAILY_REQUEST_LIMIT) {
        await recordSimplefinRequest(db, {
          endpoint: "/accounts",
          outcome: "skipped_quota",
        });
        throw new Error(
          `Paused: ${used} SimpleFIN requests in the last 24 hours (Ledgr's limit is ${SIMPLEFIN_DAILY_REQUEST_LIMIT}, below SimpleFIN's daily quota). Syncing resumes automatically.`,
        );
      }
    }
    // Based on the last complete investment ingest, not the balance sync:
    // the first sync after upgrading (or after a failed ingest) must reach
    // back the full window SimpleFIN still holds.
    const windowStart = transactionWindowStart(
      await getInvestmentsSyncedAt(db),
      asOfDate,
      await getWindowLimitDays(db),
    );
    let response: Awaited<ReturnType<typeof getAccounts>>;
    try {
      response = await getAccounts(accessUrl, { startDate: windowStart });
      await recordSimplefinRequest(db, {
        endpoint: "/accounts",
        outcome: replay ? "replay" : "ok",
        httpStatus: replay ? null : 200,
      });
    } catch (e) {
      await recordSimplefinRequest(db, {
        endpoint: "/accounts",
        outcome:
          e instanceof BudgetApiError && e.code === "timeout"
            ? "timeout"
            : "error",
        httpStatus: e instanceof BudgetApiError ? e.status : null,
      });
      throw e;
    }
    const {
      accounts: fetched,
      providerErrors,
      accountIdsWithErrors,
      windowLimitDays,
    } = response;
    // The provider trimmed our history request: remember its limit so the
    // next request stays inside it (and this isn't reported as an error).
    if (windowLimitDays) await learnWindowLimit(db, windowLimitDays);
    const fetchedIds = new Set(fetched.map((a) => a.id));
    const missingAccounts = expectedIncluded.filter(
      (a) => !fetchedIds.has(a.externalAccountId),
    );

    await upsertSimplefinAccounts(db, fetched);

    // Re-query the full included set rather than trusting the upsert's
    // RETURNING rows — those only cover accounts present in this fetch, so
    // a missing account's stale (but still real) balance needs to be
    // re-read from the DB to keep contributing to today's total.
    const allIncluded = await db
      .select()
      .from(schema.simplefinAccounts)
      .where(eq(schema.simplefinAccounts.isIncluded, true));
    const totalBalance = allIncluded.reduce(
      (sum, a) => sum + Number(a.lastBalance),
      0,
    );
    const accountCount = allIncluded.length;
    const snapshotDate = localDateStr(asOfDate);

    await writeSnapshot(db, snapshotDate, totalBalance, accountCount);

    const missingWarning =
      missingAccounts.length > 0
        ? `${missingAccounts.length} of ${expectedIncluded.length} linked account${expectedIncluded.length === 1 ? "" : "s"} didn't respond this sync (will retry): ${missingAccounts.map((a) => `${a.orgName} ${a.accountName}`).join(", ")}`
        : null;

    if (missingAccounts.length === 0) {
      // Full success — mark synced today and reset the retry counter.
      await db
        .update(schema.apiConnections)
        .set({ lastSyncedAt: asOfDate })
        .where(eq(schema.apiConnections.service, "simplefin"));
      await clearPartialSyncAttempts(db);
    } else {
      const attempts = await bumpPartialSyncAttempts(db, asOfDate);
      if (attempts >= MAX_PARTIAL_SYNC_RETRIES_PER_DAY) {
        // Give up retrying today (protects the ~24/day quota from a
        // permanently-broken account) but the warning below still says so.
        await db
          .update(schema.apiConnections)
          .set({ lastSyncedAt: asOfDate })
          .where(eq(schema.apiConnections.service, "simplefin"));
      }
      // Otherwise: deliberately leave lastSyncedAt at its previous value —
      // hasSyncedToday() will then return false, so the next hourly cron
      // tick retries instead of treating a partial sync as done for the day.
    }

    // Investment detail (holdings, transactions). A failure here must not
    // lose the balance snapshot already written — it becomes a warning.
    let investments: SimplefinSyncResult["investments"];
    const ingestWarnings: string[] = [];
    try {
      const registryRows = await db
        .select({
          id: schema.simplefinAccounts.id,
          externalAccountId: schema.simplefinAccounts.externalAccountId,
          linkedPerformanceAccountId:
            schema.simplefinAccounts.linkedPerformanceAccountId,
        })
        .from(schema.simplefinAccounts);
      const summary = await ingestInvestmentData(db, {
        accounts: fetched,
        registry: new Map(
          registryRows.map((r) => [
            r.externalAccountId,
            {
              id: r.id,
              linkedPerformanceAccountId: r.linkedPerformanceAccountId,
            },
          ]),
        ),
        windowStart: utcDayOf(windowStart),
        accountIdsWithErrors: new Set(accountIdsWithErrors ?? []),
        now: asOfDate,
      });
      const { warnings, ...counts } = summary;
      investments = counts;
      ingestWarnings.push(...warnings);
      // Only a complete ingest moves the window forward; an account that
      // reported an error is re-requested from the old start next time.
      if ((accountIdsWithErrors ?? []).length === 0)
        await setInvestmentsSyncedAt(db, asOfDate);
    } catch (e) {
      ingestWarnings.push(
        `Couldn't store holdings and transactions this sync: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
      );
    }

    const allWarnings = [
      ...providerErrors,
      ...(missingWarning ? [missingWarning] : []),
      ...ingestWarnings,
    ];
    await setSimplefinLastError(
      db,
      allWarnings.length > 0 ? allWarnings.join("; ") : null,
    );

    return {
      snapshotDate,
      totalBalance,
      accountCount,
      providerErrors: allWarnings,
      investments,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setSimplefinLastError(db, message);
    throw err;
  }
}

/**
 * Recompute today's snapshot from the local simplefin_accounts registry —
 * no SimpleFIN API call. Used when a user toggles an account's inclusion:
 * the change should be reflected immediately without burning SimpleFIN's
 * ~24-requests/day quota. Sums whatever lastBalance each included account
 * had as of its own last sync, so is only as fresh as the least-recently-
 * synced included account (bounded to <=24h by the daily cron).
 */
export async function recomputeTodaySnapshotFromLocal(
  db: Db,
  asOfDate: Date = new Date(),
): Promise<SimplefinSyncResult> {
  const rows = await db
    .select()
    .from(schema.simplefinAccounts)
    .where(eq(schema.simplefinAccounts.isIncluded, true));

  const totalBalance = rows.reduce((sum, r) => sum + Number(r.lastBalance), 0);
  const accountCount = rows.length;
  const snapshotDate = localDateStr(asOfDate);

  await writeSnapshot(db, snapshotDate, totalBalance, accountCount);

  return { snapshotDate, totalBalance, accountCount, providerErrors: [] };
}
