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

import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { encryptJson, readMaybeEncrypted } from "@/lib/crypto";
import { getAccounts, type SimplefinAccount } from "./client";

type Db = typeof import("@/lib/db").db;

export type SimplefinConfig = {
  accessUrl: string;
};

export type SimplefinSyncResult = {
  snapshotDate: string;
  totalBalance: number;
  accountCount: number;
};

/** Get the api_connections row for the simplefin service, or null if not configured. */
export async function getSimplefinConnection(db: Db) {
  const rows = await db
    .select()
    .from(schema.apiConnections)
    .where(eq(schema.apiConnections.service, "simplefin"))
    .limit(1);
  return rows[0] ?? null;
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

/** Local (not UTC) calendar date as YYYY-MM-DD, matching the version-cron convention. */
function localDateStr(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export type SimplefinAccountRow = {
  id: number;
  externalAccountId: string;
  orgName: string;
  accountName: string;
  lastBalance: number;
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
  const rows = await Promise.all(
    accounts.map(async (a) => {
      const now = new Date();
      const [row] = await db
        .insert(schema.simplefinAccounts)
        .values({
          externalAccountId: a.id,
          orgName: a.orgName,
          accountName: a.name,
          lastBalance: a.balance.toFixed(2),
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: schema.simplefinAccounts.externalAccountId,
          set: {
            orgName: a.orgName,
            accountName: a.name,
            lastBalance: a.balance.toFixed(2),
            lastSeenAt: now,
          },
        })
        .returning();
      return row!;
    }),
  );
  // Drizzle returns decimal columns as strings — convert before any caller sums lastBalance.
  return rows.map((r) => ({
    id: r.id,
    externalAccountId: r.externalAccountId,
    orgName: r.orgName,
    accountName: r.accountName,
    lastBalance: Number(r.lastBalance),
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

  const { accessUrl } = readMaybeEncrypted<SimplefinConfig>(conn.config);
  const fetched = await getAccounts(accessUrl);
  const accounts = await upsertSimplefinAccounts(db, fetched);
  const included = accounts.filter((a) => a.isIncluded);
  const totalBalance = included.reduce((sum, a) => sum + a.lastBalance, 0);
  const accountCount = included.length;
  const snapshotDate = localDateStr(asOfDate);

  await writeSnapshot(db, snapshotDate, totalBalance, accountCount);

  await db
    .update(schema.apiConnections)
    .set({ lastSyncedAt: new Date() })
    .where(eq(schema.apiConnections.service, "simplefin"));

  return { snapshotDate, totalBalance, accountCount };
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

  return { snapshotDate, totalBalance, accountCount };
}
