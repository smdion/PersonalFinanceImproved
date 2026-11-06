/**
 * The PostgreSQL test database's file lock (test-database-lock.ts), on a
 * stand-in client: a session lock taken after connecting, released before
 * the connection closes, and two holders take turns.
 */
import { describe, it, expect } from "vitest";
import {
  lockTestDatabase,
  releaseTestDatabase,
  TEST_DATABASE_LOCK,
  type LockClient,
} from "./test-database-lock";

/** One database's advisory locks: `pg_advisory_lock` waits while another
 *  session holds the key, as PostgreSQL's does. */
function fakeDatabase() {
  let holder: object | null = null;
  const waiting: (() => void)[] = [];
  const log: string[] = [];
  function client(name: string, failOn?: string): LockClient {
    const self = {};
    const query = async (sql: string, params: number[]) => {
      log.push(`${name} ${sql.split("(")[0]} ${JSON.stringify(params)}`);
      if (failOn && sql.includes(failOn)) throw new Error("query failed");
      if (sql.includes("pg_advisory_lock(")) {
        while (holder && holder !== self)
          await new Promise<void>((resolve) => waiting.push(resolve));
        holder = self;
      } else if (sql.includes("pg_advisory_unlock(") && holder === self) {
        holder = null;
        waiting.splice(0).forEach((wake) => wake());
      }
      return { rows: [] };
    };
    return {
      connect: async () => void log.push(`${name} connect`),
      end: async () => void log.push(`${name} end`),
      query,
    };
  }
  return { client, log };
}

const KEY = JSON.stringify([...TEST_DATABASE_LOCK]);

describe("the test database lock", () => {
  it("connects, then takes the session lock; release unlocks, then closes", async () => {
    const db = fakeDatabase();
    const a = db.client("a");
    await lockTestDatabase(a);
    await releaseTestDatabase(a);
    expect(db.log).toEqual([
      "a connect",
      `a SELECT pg_advisory_lock ${KEY}`,
      `a SELECT pg_advisory_unlock ${KEY}`,
      "a end",
    ]);
  });

  it("makes a second file wait until the first releases", async () => {
    const db = fakeDatabase();
    const a = db.client("a");
    const b = db.client("b");
    await lockTestDatabase(a);
    let bHolds = false;
    const bTurn = lockTestDatabase(b).then(() => (bHolds = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(bHolds).toBe(false);
    await releaseTestDatabase(a);
    await bTurn;
    expect(bHolds).toBe(true);
    await releaseTestDatabase(b);
  });

  it("closes the connection when the lock can't be taken", async () => {
    const db = fakeDatabase();
    await expect(
      lockTestDatabase(db.client("a", "pg_advisory_lock(")),
    ).rejects.toThrow("query failed");
    expect(db.log.at(-1)).toBe("a end");
  });

  it("closes the connection when the unlock fails", async () => {
    const db = fakeDatabase();
    const a = db.client("a", "pg_advisory_unlock(");
    await lockTestDatabase(a);
    await expect(releaseTestDatabase(a)).rejects.toThrow("query failed");
    expect(db.log.at(-1)).toBe("a end");
  });
});
