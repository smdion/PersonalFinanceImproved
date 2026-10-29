// SimpleFIN request ledger — every outbound call is recorded so Ledgr stays
// under SimpleFIN Bridge's per-access-URL daily quota (~24 requests/day;
// going over can disable the token). The cron, "Sync Now" and the
// connection test all count. Replayed (development) reads are recorded but
// don't count.
import "server-only";
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

type Db = typeof import("@/lib/db").db;

const SERVICE = "simplefin";
/** Hard stop below SimpleFIN Bridge's ~24/day quota, leaving headroom. */
export const SIMPLEFIN_DAILY_REQUEST_LIMIT = 20;
/** Minimum gap between manual "Sync Now" requests. */
export const SIMPLEFIN_MANUAL_SYNC_MIN_GAP_MS = 10 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type SimplefinRequestOutcome =
  "ok" | "error" | "timeout" | "replay" | "skipped_quota";

export async function recordSimplefinRequest(
  db: Db,
  entry: {
    endpoint: string;
    outcome: SimplefinRequestOutcome;
    httpStatus?: number | null;
    at?: Date;
  },
): Promise<void> {
  await db.insert(schema.syncRequestLog).values({
    service: SERVICE,
    endpoint: entry.endpoint,
    outcome: entry.outcome,
    httpStatus: entry.httpStatus ?? null,
    ...(entry.at ? { requestedAt: entry.at } : {}),
  });
}

/** Real requests (not replays or skips) in the 24 hours before `now`. */
export async function countSimplefinRequestsLastDay(
  db: Db,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.syncRequestLog)
    .where(
      and(
        eq(schema.syncRequestLog.service, SERVICE),
        gte(
          schema.syncRequestLog.requestedAt,
          new Date(now.getTime() - DAY_MS),
        ),
        ne(schema.syncRequestLog.outcome, "replay"),
        ne(schema.syncRequestLog.outcome, "skipped_quota"),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/** When the most recent real request was made, if any. */
export async function lastSimplefinRequestAt(db: Db): Promise<Date | null> {
  const rows = await db
    .select({ at: schema.syncRequestLog.requestedAt })
    .from(schema.syncRequestLog)
    .where(
      and(
        eq(schema.syncRequestLog.service, SERVICE),
        ne(schema.syncRequestLog.outcome, "replay"),
        ne(schema.syncRequestLog.outcome, "skipped_quota"),
      ),
    )
    .orderBy(sql`${schema.syncRequestLog.requestedAt} desc`)
    .limit(1);
  return rows[0]?.at ?? null;
}

/** Drop ledger rows older than 30 days. */
export async function pruneSimplefinRequestLog(
  db: Db,
  now: Date = new Date(),
): Promise<void> {
  await db
    .delete(schema.syncRequestLog)
    .where(
      lt(
        schema.syncRequestLog.requestedAt,
        new Date(now.getTime() - RETENTION_MS),
      ),
    );
}
