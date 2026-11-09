import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { isPostgres, type Db, type DbOrTx } from "@/lib/db";
import { execRaw } from "@/lib/db/compat";

/** Insert one app setting, or replace the whole stored value on a key
 *  conflict (SQLite and PostgreSQL alike). To change part of a stored map
 *  without losing a concurrent writer's part, use `mergeSettingAtomically`. */
export async function upsertSetting(
  db: Pick<Db, "insert"> | DbOrTx,
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
}

let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Read, change and write one app setting as a single step (queued in-process, plus a
 * Postgres key lock), so concurrent writers of one map both stick. `change` returns
 * the new value, or null to leave it; returns what `change` returned.
 */
export function mergeSettingAtomically<T>(
  db: Db,
  key: string,
  change: (stored: unknown) => T,
): Promise<T> {
  return oneAtATime(async () => {
    const apply = async (tx: Db) => {
      const [row] = await tx
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, key));
      const value = change(row?.value ?? null);
      if (value === null) return value;
      await upsertSetting(tx, key, value);
      return value;
    };
    // SQLite: one process, one connection — the queue is the lock
    // (concurrent async transactions on one connection interleave).
    if (!isPostgres()) return apply(db);
    return db.transaction(async (tx) => {
      await execRaw(
        tx as never,
        sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`,
      );
      return apply(tx as never);
    });
  });
}
