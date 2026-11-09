/**
 * Async `db.transaction(async (tx) => …)` on SQLite (better-sqlite3 rejects a promise-returning
 * callback): commits on resolve, rolls back on throw, one at a time. A nested call, or one made
 * inside a running transaction (AsyncLocalStorage), is a savepoint so it never queues behind it.
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
