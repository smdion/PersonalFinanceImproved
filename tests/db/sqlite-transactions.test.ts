/** On a real better-sqlite3 connection, unpatched: the app's async
 *  transactions commit, roll back, nest and queue. */
import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { withAsyncTransactions } from "@/lib/db/sqlite-transactions";

type Tx = { transaction: <R>(fn: (tx: Tx) => Promise<R>) => Promise<R> };

let sqlite: Database.Database;
let db: Tx;
const insert = (v: number) => sqlite.prepare("INSERT INTO t VALUES (?)").run(v);
const rows = () =>
  (
    sqlite.prepare("SELECT v FROM t ORDER BY rowid").all() as { v: number }[]
  ).map((r) => r.v);

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE t (v INTEGER)");
  db = withAsyncTransactions({} as Tx, sqlite);
});

describe("withAsyncTransactions", () => {
  it("runs an async callback and commits it", async () => {
    const result = await db.transaction(async () => {
      insert(1);
      await Promise.resolve();
      insert(2);
      return "done";
    });
    expect(result).toBe("done");
    expect(rows()).toEqual([1, 2]);
  });

  it("rolls everything back when the callback throws", async () => {
    await expect(
      db.transaction(async () => {
        insert(1);
        await Promise.resolve();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(rows()).toEqual([]);
    expect(sqlite.inTransaction).toBe(false);
  });

  it("a nested transaction is a savepoint", async () => {
    await db.transaction(async (tx) => {
      insert(1);
      await tx
        .transaction(async () => {
          insert(2);
          throw new Error("inner");
        })
        .catch(() => undefined);
      insert(3);
    });
    expect(rows()).toEqual([1, 3]);
  });

  it("the plain handle used inside a transaction nests, not deadlocks", async () => {
    await db.transaction(async () => {
      insert(1);
      await db.transaction(async () => insert(2));
    });
    expect(rows()).toEqual([1, 2]);
  });

  it("transactions queue instead of overlapping", async () => {
    await Promise.all(
      [1, 2].map((n) =>
        db.transaction(async () => {
          insert(n);
          await new Promise((r) => setTimeout(r, 5));
          insert(n * 10);
        }),
      ),
    );
    expect(rows()).toEqual([1, 10, 2, 20]);
  });

  it("the next transaction runs after one fails", async () => {
    await db
      .transaction(async () => Promise.reject(new Error("x")))
      .catch(() => undefined);
    await db.transaction(async () => insert(1));
    expect(rows()).toEqual([1]);
  });
});
