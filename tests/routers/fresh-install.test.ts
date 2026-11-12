/**
 * A fresh install on SQLite: the real migrator runs once on an empty temp
 * file and each case gets its own copy, then goes through the app's
 * procedures as a first run does (the cases are in ./fresh-install-cases,
 * shared with PostgreSQL). Not createTestDb: its template applies the tax
 * data directly, which isn't what an install runs.
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

/** The migrator runs once, on an empty file; each case gets its own copy. */
let migrated: string | undefined;
function migratedTemplate(): string {
  if (migrated) return migrated;
  const template = path.join(dir, "migrated-template.db");
  runMigrator({
    SQLITE_PATH: template,
    DATABASE_URL: "",
    LEDGR_BACKUP_DIR: path.join(dir, "backups"),
  });
  return (migrated = template);
}

describe("fresh install (SQLite)", () => {
  freshInstallCases(async () => {
    const dbPath = path.join(dir, `ledgr-${open.length}.db`);
    fs.copyFileSync(migratedTemplate(), dbPath);
    const sqlite = new Database(dbPath);
    open.push(sqlite);
    const plainDb = drizzle(sqlite, { schema: sqliteSchema });
    const db = withAsyncTransactions(plainDb, sqlite);
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
