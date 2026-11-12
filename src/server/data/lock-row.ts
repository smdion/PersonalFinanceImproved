/**
 * Locks held to the transaction's end, so read-merge-writes run one at a time (PostgreSQL;
 * SQLite is serial). Order: job (key share), salary profile, budget profile, contribution
 * profiles, performance years ascending; never an earlier kind after a later.
 */
import { eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
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

/** A row about to be merged into, read under its lock (`SELECT … FOR UPDATE`): a row's
 *  stored JSON changes only through this read. Undefined when the row is gone. */
export async function lockedRow<T extends PgTable & { id: PgColumn }>(
  tx: DbOrTx,
  table: T,
  id: number,
): Promise<T["$inferSelect"] | undefined> {
  await holdLock(
    tx,
    sql`SELECT 1 FROM ${table} WHERE ${table.id} = ${id} FOR UPDATE`,
  );
  const rows = await tx
    .select()
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- drizzle's from() takes no generic table; the rows are T's select shape (below)
    .from(table as PgTable)
    .where(eq(table.id, id));
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a select of all of T's columns is T's select shape
  return (rows as T["$inferSelect"][])[0];
}
