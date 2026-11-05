/**
 * Read, change and write one app setting as a single step — queued in this
 * process and, on Postgres, under a transaction lock on the key — so two
 * writers changing different parts of the same map both stick (a browser's
 * whole-map upsert could drop one).
 */
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { isPostgres, type Db } from "@/lib/db";
import { execRaw } from "@/lib/db/compat";
import { upsertSetting } from "@/server/data/settings";

let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** `change` gets the stored value and returns the new one, or null to
 *  leave it as it is. Returns what `change` returned. */
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
