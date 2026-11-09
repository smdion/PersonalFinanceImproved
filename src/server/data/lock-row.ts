/**
 * A named lock held until the transaction ends, so same-name check-then-write steps run
 * one at a time. PostgreSQL: advisory transaction lock; SQLite: none (transactions are serial).
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
