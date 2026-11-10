/**
 * Async `db.transaction(async (tx) => …)` on SQLite: commits on resolve, rolls back on throw,
 * one at a time; a call inside a running one (AsyncLocalStorage) is a savepoint, and a query
 * awaited outside it waits for it to end (on the one connection it would otherwise join it).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { entityKind } from "drizzle-orm";

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
  /** Settles when the transaction now running ends. */
  let running: Promise<void> = Promise.resolve();

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

  const outside = () => sqlite.inTransaction && !inTransaction.getStore();
  /** Runs `go` once no transaction is open, checked when it runs: never
   *  inside a transaction that began while it waited. */
  const whenNoneOpen = (go: () => unknown): Promise<unknown> =>
    outside()
      ? running.then(() => whenNoneOpen(go))
      : Promise.resolve().then(go);
  const isBuilder = (o: unknown): o is object =>
    typeof o === "object" &&
    o !== null &&
    !(o instanceof Promise) &&
    typeof o.constructor === "function" &&
    entityKind in o.constructor;
  /** `o` with every query built from it, when awaited outside every
   *  transaction while one is open, run after that transaction ends;
   *  `tables` gates each property too (`db.query.<table>`). */
  const gate = <O extends object>(o: O, tables = false): O =>
    new Proxy(o, {
      get: (target, key) => {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") {
          const isObject = typeof value === "object" && value !== null;
          if (isObject && key === "query") return gate(value, true);
          return isObject && tables ? gate(value) : value;
        }
        if (key === "transaction") return value;
        if (key === "then")
          return (...args: unknown[]) =>
            outside()
              ? whenNoneOpen(() => value.apply(target, args))
              : value.apply(target, args);
        return (...args: unknown[]) => {
          const out: unknown = value.apply(target, args);
          return isBuilder(out) ? gate(out) : out;
        };
      },
    });

  (db as T & WithTransaction).transaction = (fn: (tx: T) => unknown) => {
    if (inTransaction.getStore()) return nested(fn);
    const run = async () => {
      let ended!: () => void;
      running = new Promise<void>((resolve) => (ended = resolve));
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = await inTransaction.run(true, () => fn(tx));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        ended();
      }
    };
    const turn = queue.then(run, run);
    queue = turn.catch(() => undefined);
    return turn;
  };
  return gate(db);
}
