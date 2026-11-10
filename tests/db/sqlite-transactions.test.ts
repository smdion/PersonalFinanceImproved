/** On a real better-sqlite3 connection, unpatched: the app's async
 *  transactions commit, roll back, nest and queue, and a query from outside
 *  an open one waits for it. */
import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
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

describe("a query from outside an open transaction (drizzle)", () => {
  const t = sqliteTable("t", { v: integer("v").notNull() });
  let gated: BetterSQLite3Database<{ t: typeof t }>;
  const pause = () => new Promise((r) => setTimeout(r, 10));

  beforeEach(() => {
    const plain = drizzle(sqlite, { schema: { t } });
    gated = withAsyncTransactions(plain, sqlite);
  });

  /** A transaction that writes 1, yields, then fails, with `outside`
   *  started while it is open; returns what `outside` saw. */
  async function during<R>(outside: () => Promise<R>): Promise<R> {
    const tx = gated
      .transaction(async (inner) => {
        await inner.insert(t).values({ v: 1 });
        await pause();
        throw new Error("rolled back");
      })
      .catch(() => undefined);
    await Promise.resolve();
    expect(sqlite.inTransaction).toBe(true);
    const seen = await outside();
    await tx;
    return seen;
  }

  it("a write waits for it, so the rollback doesn't take it", async () => {
    await during(() =>
      gated
        .insert(t)
        .values({ v: 2 })
        .then(() => null),
    );
    expect(rows()).toEqual([2]);
  });

  it("a read waits for it, so it never sees an uncommitted row", async () => {
    expect(await during(() => gated.select().from(t))).toEqual([]);
    expect(await during(() => gated.query.t.findMany())).toEqual([]);
  });

  it("a write never lands inside a transaction queued while it waited", async () => {
    const failing = () =>
      gated
        .transaction(async (inner) => {
          await inner.insert(t).values({ v: 1 });
          await pause();
          throw new Error("rolled back");
        })
        .catch(() => undefined);
    const first = failing();
    await Promise.resolve();
    const second = failing();
    const write = gated.insert(t).values({ v: 2 });
    await Promise.all([first, second, write]);
    expect(rows()).toEqual([2]);
  });

  it("with nothing open, a query runs at once", async () => {
    await gated.insert(t).values({ v: 3 });
    expect(await gated.select().from(t)).toEqual([{ v: 3 }]);
  });

  it("inside the transaction, the outer handle still reads its own rows", async () => {
    const seen = await gated.transaction(async (inner) => {
      await inner.insert(t).values({ v: 4 });
      return gated.select().from(t);
    });
    expect(seen).toEqual([{ v: 4 }]);
  });
});
