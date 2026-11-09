/**
 * A tag with several converters, and converters that insert and delete:
 * each converter reads its tables fresh after the one before it wrote, a
 * result applies as deletes, updates, inserts, every write names one row,
 * on both dialects, in the restore step and in the real SQLite migrator.
 * The replay-twice helper (converter-replay.ts) passes a projection and
 * fails a converter that isn't idempotent, and passes 0016 then 0017.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { DataConverter } from "@/lib/db/migrate/migration-converters";
import { MATCH_RATE_CONVERTER } from "@/lib/db/migrate/v0102-match-rate";
import { MATCH_VALUE_CONVERTER } from "@/lib/db/migrate/v0102-match-value";
import { VALUE_ACCOUNTS, VALUE_PROFILES } from "./match-value-cases";
import { ACCOUNT_CASES, PROFILE_CASES } from "./match-rate-cases";
import {
  expectRestoreReplaySafe,
  expectSqliteReplaySafe,
} from "./converter-replay";
import { appends, counts, over, purges, renames } from "./converter-list-cases";

const hook = vi.hoisted(() => ({
  converters: {} as Record<string, DataConverter | DataConverter[]>,
}));
vi.mock("@/lib/db/migrate/migration-converters", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MIGRATION_CONVERTERS: hook.converters,
}));

import {
  convertBackup,
  runConverterPg,
  runConverterSqlite,
  tagConverters,
} from "@/lib/db/migrate/migration-converters";
import { runSQLite } from "../../db-migrate";

const TAG = "0015_v0102_dead_data";

const settingsDb = () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, key TEXT, value TEXT)",
  );
  db.exec(
    `INSERT INTO app_settings VALUES (1, 'invented_a', 'x'), (2, 'retired_b', 'y'), (3, 'kept_c', 'z')`,
  );
  return db;
};
const keysIn = (db: Database.Database) =>
  db.prepare("SELECT id, key, value FROM app_settings ORDER BY id").all();

describe("a tag's converter list", () => {
  it("one converter or a list: tagConverters gives them in order", () => {
    const registry = { a: renames, b: [renames, counts] };
    expect(tagConverters("a", registry)).toEqual([renames]);
    expect(tagConverters("b", registry)).toEqual([renames, counts]);
    expect(tagConverters("toString", registry)).toEqual([]);
  });

  it("SQLite: each reads after the one before wrote; one tally per phase", () => {
    const db = settingsDb();
    const run = runConverterSqlite(
      db,
      { [TAG]: [renames, counts, purges] },
      TAG,
      "afterSql",
    );
    expect(run).toEqual({ updates: 1, inserts: 1, deletes: 1, notes: [] });
    expect(keysIn(db)).toEqual([
      { id: 1, key: "moved_a", value: "x" },
      { id: 3, key: "kept_c", value: "z" },
      { id: 4, key: "moved_count", value: "1" },
    ]);
  });

  it("runs only the list's converters for the phase asked", () => {
    const db = settingsDb();
    const before = over(() => ({ updates: [] }), "beforeSql");
    const seen = vi.spyOn(before, "convert");
    expect(
      runConverterSqlite(db, { [TAG]: [before, renames] }, TAG, "afterSql"),
    ).toEqual({ updates: 1, notes: [] });
    expect(seen).not.toHaveBeenCalled();
    expect(
      runConverterSqlite(db, { [TAG]: [renames] }, TAG, "beforeSql"),
    ).toBeNull();
  });

  it("applies a result as deletes, then updates, then inserts", () => {
    const db = settingsDb();
    const all = over(() => ({
      inserts: [{ table: "app_settings", row: { key: "new_d", value: "w" } }],
      updates: [{ table: "app_settings", id: 3, set: { value: "zz" } }],
      deletes: [{ table: "app_settings", id: 2 }],
    }));
    const order: string[] = [];
    const spy = {
      prepare: (sql: string) => {
        if (/^(INSERT|UPDATE|DELETE)/.test(sql)) order.push(sql.split(" ")[0]!);
        return db.prepare(sql);
      },
    };
    runConverterSqlite(spy, { [TAG]: all }, TAG, "afterSql");
    expect(order).toEqual(["DELETE", "UPDATE", "INSERT"]);
  });

  it("refuses an insert naming an id and a delete of no row, writing nothing", () => {
    const db = settingsDb();
    const naming = over(() => ({
      updates: [{ table: "app_settings", id: 1, set: { value: "q" } }],
      inserts: [{ table: "app_settings", row: { id: 9, key: "k" } }],
    }));
    expect(() =>
      runConverterSqlite(db, { [TAG]: naming }, TAG, "afterSql"),
    ).toThrow(/sets nothing or names an id/);
    expect(keysIn(db)).toEqual(keysIn(settingsDb()));
    const missing = over(() => ({
      updates: [],
      deletes: [{ table: "app_settings", id: 99 }],
    }));
    expect(() =>
      runConverterSqlite(db, { [TAG]: missing }, TAG, "afterSql"),
    ).toThrow(/delete app_settings id 99 changed 0 rows, not 1/);
  });

  it("PostgreSQL: inserts and deletes with numbered parameters, JSON as text", async () => {
    const calls: [string, unknown[] | undefined][] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push([sql, params]);
        if (sql.startsWith("SELECT to_regclass"))
          return { rows: [{ present: true }] };
        if (sql.startsWith("SELECT *"))
          return { rows: [{ id: 2, key: "retired_b", value: "y" }] };
        return { rows: [], rowCount: 1 };
      },
    };
    const run = await runConverterPg(
      client,
      {
        [TAG]: [
          purges,
          over(() => ({
            updates: [],
            inserts: [
              { table: "app_settings", row: { key: "k", value: { n: 1 } } },
            ],
          })),
        ],
      },
      TAG,
      "afterSql",
    );
    expect(run).toEqual({ updates: 0, inserts: 1, deletes: 1, notes: [] });
    expect(calls.filter(([sql]) => !sql.startsWith("SELECT"))).toEqual([
      ['DELETE FROM "app_settings" WHERE "id" = $1', [2]],
      [
        'INSERT INTO "app_settings" ("key", "value") VALUES ($1, $2)',
        ["k", '{"n":1}'],
      ],
    ]);
  });

  it("PostgreSQL: a write that changes no row stops the run", async () => {
    const client = {
      query: async (sql: string) =>
        sql.startsWith("SELECT to_regclass")
          ? { rows: [{ present: true }] }
          : sql.startsWith("SELECT *")
            ? { rows: [{ id: 2, key: "retired_b", value: "y" }] }
            : { rows: [], rowCount: 0 },
    };
    await expect(
      runConverterPg(client, { [TAG]: purges }, TAG, "afterSql"),
    ).rejects.toThrow(/delete app_settings id 2 changed 0 rows, not 1/);
  });

  it("the restore step: each reads after the one before; an insert takes the next id", () => {
    const tables: Record<string, unknown[]> = {
      app_settings: [
        { id: 1, key: "invented_a", value: "x" },
        { id: 7, key: "retired_b", value: "y" },
      ],
    };
    const run = convertBackup(
      tables,
      { [TAG]: [renames, purges, counts] },
      TAG,
    );
    expect(run).toEqual({ updates: 1, inserts: 1, deletes: 1, notes: [] });
    expect(tables["app_settings"]).toEqual([
      { id: 1, key: "moved_a", value: "x" },
      { id: 2, key: "moved_count", value: "1" },
    ]);
    const missing = over(() => ({
      updates: [],
      deletes: [{ table: "app_settings", id: 99 }],
    }));
    expect(() => convertBackup(tables, { [TAG]: missing }, TAG)).toThrow(
      /changed 0 rows, not 1/,
    );
  });
});

describe("the replay-twice helper", () => {
  it("passes a projection and a list that inserts and deletes once", () => {
    expectRestoreReplaySafe([renames, counts, purges], {
      app_settings: [
        { id: 1, key: "invented_a", value: "x" },
        { id: 2, key: "retired_b", value: "y" },
      ],
    });
    expectSqliteReplaySafe(settingsDb(), [renames, counts, purges]);
  });

  it("fails a converter that changes its own output", () => {
    expect(() =>
      expectRestoreReplaySafe(appends, {
        app_settings: [{ id: 1, key: "a", value: "x" }],
      }),
    ).toThrow();
    expect(() => expectSqliteReplaySafe(settingsDb(), appends)).toThrow();
  });

  it("passes 0016 then 0017 over every case", () => {
    const tables = {
      contribution_accounts: [
        ...ACCOUNT_CASES.map((c) => ({
          id: c.id,
          employer_match_type: c.type,
          employer_match_value: c.value,
        })),
        ...VALUE_ACCOUNTS.map((c) => ({
          id: 100 + c.id,
          employer_match_type: c.type,
          employer_match_value: c.value,
          employer_match_rate: c.rate,
        })),
      ],
      contribution_profiles: [...PROFILE_CASES, ...VALUE_PROFILES].map(
        (c, i) => ({
          id: i + 1,
          contribution_active_fields: structuredClone(c.before),
        }),
      ),
    };
    expectRestoreReplaySafe(
      [MATCH_RATE_CONVERTER, MATCH_VALUE_CONVERTER],
      tables,
    );
  });
});

describe("a converter list in the real SQLite migrator", () => {
  let dir: string;
  const env = { ...process.env };
  const REPO = process.cwd();
  const journalPath = () =>
    path.join(dir, "drizzle-sqlite", "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    for (const k of Object.keys(hook.converters)) delete hook.converters[k];
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-converter-lists-"));
    fs.cpSync(
      path.join(REPO, "drizzle-sqlite"),
      path.join(dir, "drizzle-sqlite"),
      { recursive: true },
    );
    for (const data of ["tax-data", "reference-data"])
      fs.symlinkSync(path.join(REPO, data), path.join(dir, data));
    process.env.SQLITE_PATH = path.join(dir, "ledgr.db");
    process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
    delete process.env.LEDGR_SKIP_PREMIGRATION_BACKUP;
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(REPO);
    process.env = { ...env };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** An install at 0014 (0015 and later pending), with invented settings. */
  function installBehind() {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    journal.entries = journal.entries.slice(
      0,
      journal.entries.findIndex((e) => e.tag === TAG),
    );
    fs.writeFileSync(journalPath(), JSON.stringify(journal));
    runSQLite();
    const db = open();
    db.exec(
      `INSERT INTO app_settings (key, value) VALUES ('invented_a', '"x"'), ('retired_b', '"y"')`,
    );
    db.close();
    fs.writeFileSync(journalPath(), shipped);
  }
  const invented = () => {
    const db = open();
    const rows = db
      .prepare(
        "SELECT key, value FROM app_settings WHERE key LIKE 'moved_%' OR key LIKE 'invented_%' OR key LIKE 'retired_%' ORDER BY key",
      )
      .all();
    db.close();
    return rows;
  };

  it("runs the list in the pending loop, and nothing on a later start", () => {
    installBehind();
    hook.converters[TAG] = [renames, counts, purges];
    runSQLite();
    const once = invented();
    expect(once).toEqual([
      { key: "moved_a", value: '"x"' },
      { key: "moved_count", value: "1" },
    ]);
    runSQLite();
    expect(invented()).toEqual(once);
  });

  it("runs it again in a squash replay, writing nothing twice", () => {
    installBehind();
    hook.converters[TAG] = [renames, counts, purges];
    runSQLite();
    const once = invented();
    const db = open();
    db.exec("DELETE FROM __drizzle_migrations");
    db.close();
    runSQLite();
    expect(invented()).toEqual(once);
  });
});
