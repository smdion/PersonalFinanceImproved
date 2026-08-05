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
import { getAccounts } from "./client";

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

/**
 * Pull current balances from SimpleFIN and upsert today's snapshot row.
 * Upserting on snapshotDate (rather than skip-if-exists) means calling
 * this multiple times in one day — cron plus a manual "Sync Now" — is
 * safe and keeps the snapshot current, without ever creating a duplicate
 * row for the same day.
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
  const accounts = await getAccounts(accessUrl);
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const accountCount = accounts.length;
  const snapshotDate = localDateStr(asOfDate);

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

  await db
    .update(schema.apiConnections)
    .set({ lastSyncedAt: new Date() })
    .where(eq(schema.apiConnections.service, "simplefin"));

  return { snapshotDate, totalBalance, accountCount };
}
