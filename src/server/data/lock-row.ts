/**
 * Locks held until the transaction ends, so read-merge-writes run one at a time. PostgreSQL only
 * (SQLite's transactions are serial). Order inside one transaction: salary profile, budget
 * profile, performance years ascending; a transaction never takes an earlier kind after a later.
 */
import { sql, type Column, type SQL, type Table } from "drizzle-orm";
import { isPostgres } from "@/lib/db/dialect";
import { execRaw } from "@/lib/db/compat";
import type { DbOrTx } from "@/lib/db";

/** First key of every lock here (two-key form): never collides with
 *  single-key locks such as mergeSettingAtomically's (data/settings.ts).
 *  "LDGR" in ASCII. */
const LOCK_NAMESPACE = 0x4c444752;

async function holdLock(tx: DbOrTx, query: SQL): Promise<void> {
  if (!isPostgres()) return;
  await execRaw(tx as never, query);
}

/** Call first inside `db.transaction(async (tx) => …)`, with that `tx`. */
export function lockForTransaction(tx: DbOrTx, name: string): Promise<void> {
  return holdLock(
    tx,
    sql`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int4, hashtext(${name}))`,
  );
}

/** Locks one row (`SELECT … FOR UPDATE`): call before reading the row to merge into it. */
export function lockRow(
  tx: DbOrTx,
  table: Table & { id: Column },
  id: number,
): Promise<void> {
  return holdLock(
    tx,
    sql`SELECT 1 FROM ${table} WHERE ${table.id} = ${id} FOR UPDATE`,
  );
}
