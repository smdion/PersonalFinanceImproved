/**
 * Async transactions on SQLite. Every transaction in the app is written the
 * Postgres way, `db.transaction(async (tx) => …)`, but better-sqlite3's own
 * refuses a callback that returns a promise, so on a SQLite install each one
 * failed outright. This gives the SQLite handle the same contract: commit
 * when the callback resolves, roll back when it throws.
 *
 * One connection means one transaction at a time, so they queue. A nested
 * `tx.transaction` is a savepoint, as on Postgres, and so is a helper inside
 * one that calls the plain handle's `transaction` (AsyncLocalStorage knows):
 * queueing it behind the transaction it's running in would never finish.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type RawSqlite = {
  exec(sql: string): unknown;
  inTransaction: boolean;
};
type WithTransaction = { transaction: unknown };

export function withAsyncTransactions<T extends object>(
  db: T,
  sqlite: RawSqlite,
): T {
  const inTransaction = new AsyncLocalStorage<true>();
  let depth = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const nested = async (fn: (tx: T) => unknown) => {
    const name = `ledgr_sp_${++depth}`;
    sqlite.exec(`SAVEPOINT ${name}`);
    try {
      const result = await fn(tx);
      sqlite.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      sqlite.exec(`ROLLBACK TO ${name}`);
      sqlite.exec(`RELEASE ${name}`);
      throw error;
    } finally {
      depth--;
    }
  };
  const tx = new Proxy(db, {
    get: (target, key, receiver) =>
      key === "transaction" ? nested : Reflect.get(target, key, receiver),
  });

  (db as T & WithTransaction).transaction = (fn: (tx: T) => unknown) => {
    if (inTransaction.getStore()) return nested(fn);
    const run = async () => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = await inTransaction.run(true, () => fn(tx));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
        throw error;
      }
    };
    const turn = queue.then(run, run);
    queue = turn.catch(() => undefined);
    return turn;
  };
  return db;
}
