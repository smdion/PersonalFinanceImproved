// Records every outbound SimpleFIN call (cron, Sync Now, connection test) to stay
// under the ~24/day per-access-URL quota, which can disable the token if exceeded.
// Replayed (development) reads are recorded but don't count.
import "server-only";
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { BudgetApiError } from "@/lib/budget-api/errors";
import { isSimplefinReplayMode } from "./client";
import type { Db } from "@/lib/db";
import { MS_PER_DAY } from "@/lib/constants";

const SERVICE = "simplefin";
/** Hard stop below SimpleFIN Bridge's ~24/day quota, leaving headroom. */
export const SIMPLEFIN_DAILY_REQUEST_LIMIT = 20;
/** Minimum gap between manual "Sync Now" requests. */
export const SIMPLEFIN_MANUAL_SYNC_MIN_GAP_MS = 10 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** bad_response: SimpleFIN answered in a shape Ledgr can't read; it counts
 *  against the quota like every real request. */
export type SimplefinRequestOutcome =
  "ok" | "error" | "bad_response" | "timeout" | "replay" | "skipped_quota";

/** How a failed /accounts request is logged. */
export function simplefinRequestOutcome(e: unknown): SimplefinRequestOutcome {
  if (!(e instanceof BudgetApiError)) return "error";
  if (e.code === "timeout") return "timeout";
  return e.code === "bad-response" ? "bad_response" : "error";
}

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

/** getAccounts' `onRequest` for `db`: one row per request sent. */
export function simplefinRequestRecorder(db: Db) {
  return ({ status, error }: { status: number | null; error: unknown }) =>
    recordSimplefinRequest(db, {
      endpoint: "/accounts",
      outcome: error ? simplefinRequestOutcome(error) : "ok",
      httpStatus: status,
    });
}

/** Before any real request: at Ledgr's daily limit, logs the skip and
 *  throws the pause. Replays never count, so they're never stopped. */
export async function stopAtSimplefinQuota(db: Db, now: Date): Promise<void> {
  if (isSimplefinReplayMode()) return;
  const used = await countSimplefinRequestsLastDay(db, now);
  if (used < SIMPLEFIN_DAILY_REQUEST_LIMIT) return;
  await recordSimplefinRequest(db, {
    endpoint: "/accounts",
    outcome: "skipped_quota",
  });
  throw new Error(
    `Paused: ${used} SimpleFIN requests in the last 24 hours (Ledgr's limit is ${SIMPLEFIN_DAILY_REQUEST_LIMIT}, below SimpleFIN's daily quota). Syncing resumes automatically.`,
  );
}

/** Real requests (not replays or skips) in the 24 hours before `now`. */
export async function countSimplefinRequestsLastDay(
  db: Db,
  now: Date,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.syncRequestLog)
    .where(
      and(
        eq(schema.syncRequestLog.service, SERVICE),
        gte(
          schema.syncRequestLog.requestedAt,
          new Date(now.getTime() - MS_PER_DAY),
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
  now: Date,
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
