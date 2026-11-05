/**
 * A named lock held until the transaction ends, so check-then-write steps
 * under the same name run one at a time. PostgreSQL takes an advisory
 * transaction lock; SQLite needs none, since its transactions already run
 * one at a time (src/lib/db/sqlite-transactions.ts).
 */
import { sql } from "drizzle-orm";
import { isPostgres } from "@/lib/db/dialect";
import { execRaw } from "@/lib/db/compat";
import type { DbOrTx } from "@/lib/db";

/** First key of every lock here (two-key form): never collides with
 *  single-key locks such as mergeSettingAtomically's (data/settings.ts).
 *  "LDGR" in ASCII. */
const LOCK_NAMESPACE = 0x4c444752;

/** Call first inside `db.transaction(async (tx) => …)`, with that `tx`. */
export async function lockForTransaction(
  tx: DbOrTx,
  name: string,
): Promise<void> {
  if (!isPostgres()) return;
  await execRaw(
    tx as never,
    sql`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int4, hashtext(${name}))`,
  );
}
