/**
 * A fresh install on SQLite: each case runs the real migrator on an empty
 * temp file, then goes through the app's procedures as a first run does
 * (the cases are in ./fresh-install-cases, shared with PostgreSQL). Not
 * createTestDb: its template applies the tax data directly, which isn't
 * what an install runs.
 */
import "./setup-mocks";
import { describe, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as pgSchema from "@/lib/db/schema-pg";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { withAsyncTransactions } from "@/lib/db/sqlite-transactions";
import { createCallerFactory } from "@/server/trpc";
import { appRouter } from "@/server/routers";
import { freshInstallCases, runMigrator } from "./fresh-install-cases";

const dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-fresh-install-"));
const open: InstanceType<typeof Database>[] = [];
const callerFactory = createCallerFactory(appRouter);

afterAll(() => {
  for (const sqlite of open) sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("fresh install (SQLite)", () => {
  freshInstallCases(async () => {
    const dbPath = path.join(dir, `ledgr-${open.length}.db`);
    runMigrator({
      SQLITE_PATH: dbPath,
      DATABASE_URL: "",
      LEDGR_BACKUP_DIR: path.join(dir, "backups"),
    });
    const sqlite = new Database(dbPath);
    open.push(sqlite);
    const db = drizzle(sqlite, { schema: sqliteSchema });
    withAsyncTransactions(db, sqlite);
    // eslint-disable-next-line no-restricted-syntax -- the routers are typed for PostgreSQL; the SQLite db runs them (as in ./setup)
    const rawDb = db as unknown as NodePgDatabase<typeof pgSchema>;
    return {
      caller: (session) =>
        callerFactory({ db: rawDb, session, demoSchema: null }),
      count: async (table) =>
        (
          sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as {
            n: number;
          }
        ).n,
    };
  });
});
