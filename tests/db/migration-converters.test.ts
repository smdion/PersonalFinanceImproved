/**
 * The per-tag converter hook: a tag's converter runs on both dialects, at
 * its phase, inside the migration's transaction — in the pending loop and in
 * the squash replay of the real SQLite migrator — and a converter that
 * throws leaves the database as it was.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type {
  ConverterTables,
  DataConverter,
} from "@/lib/db/migration-converters";

const hook = vi.hoisted(() => ({
  converters: {} as Record<string, DataConverter>,
}));
vi.mock("@/lib/db/migration-converters", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MIGRATION_CONVERTERS: hook.converters,
}));

import {
  runConverterPg,
  runConverterSqlite,
} from "@/lib/db/migration-converters";
import { runSQLite } from "../../db-migrate";

const TAG = "0015_v0102_dead_data";

/** Marks every invented setting, and records what it saw. */
function marker(runs: DataConverter["runs"], seen: ConverterTables[]) {
  return {
    tables: ["app_settings", "holding_observations", "no_such_table"],
    runs,
    convert: (tables: ConverterTables) => {
      seen.push(tables);
      const updates = (tables["app_settings"] ?? [])
        .map((r) => r as { id: number; key: string; value: unknown })
        .filter((r) => r.key.startsWith("invented_") && r.value !== '"done"')
        .map((r) => ({
          table: "app_settings",
          id: r.id,
          set: { value: '"done"' },
        }));
      return { updates, notes: [`${updates.length} marked`] };
    },
  } satisfies DataConverter;
}

describe("runConverterSqlite / runConverterPg", () => {
  it("SQLite: reads its tables (a missing one as absent), writes JSON as text", () => {
    const db = new Database(":memory:");
    db.exec(
      "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, key TEXT, value TEXT)",
    );
    db.exec("INSERT INTO app_settings VALUES (1, 'invented_a', '\"x\"')");
    const seen: ConverterTables[] = [];
    const c: DataConverter = {
      ...marker("afterSql", seen),
      convert: (t) => ({
        updates: [{ table: "app_settings", id: 1, set: { value: { n: 1 } } }],
        notes: [String(t["app_settings"]?.length)],
      }),
    };
    expect(runConverterSqlite(db, { [TAG]: c }, TAG, "beforeSql")).toBeNull();
    expect(
      runConverterSqlite(db, { [TAG]: c }, "other", "afterSql"),
    ).toBeNull();
    expect(runConverterSqlite(db, { [TAG]: c }, TAG, "afterSql")).toEqual({
      updates: 1,
      notes: ["1"],
    });
    expect(db.prepare("SELECT value FROM app_settings").get()).toEqual({
      value: '{"n":1}',
    });
  });

  it("PostgreSQL: checks each table exists, updates by id with numbered parameters", async () => {
    const calls: [string, unknown[] | undefined][] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push([sql, params]);
        if (sql.startsWith("SELECT to_regclass"))
          return { rows: [{ present: params?.[0] === "app_settings" }] };
        if (sql.startsWith("SELECT *"))
          return { rows: [{ id: 4, key: "invented_b", value: "x" }] };
        return { rows: [], rowCount: 1 };
      },
    };
    const seen: ConverterTables[] = [];
    const notes = await runConverterPg(
      client,
      { [TAG]: marker("afterSql", seen) },
      TAG,
      "afterSql",
    );
    expect(notes).toEqual({ updates: 1, notes: ["1 marked"] });
    expect(Object.keys(seen[0]!)).toEqual(["app_settings"]);
    expect(calls.at(-1)).toEqual([
      'UPDATE "app_settings" SET "value" = $1 WHERE "id" = $2',
      ['"done"', 4],
    ]);
    calls.length = 0;
    await runConverterPg(
      client,
      { [TAG]: marker("afterSql", []) },
      TAG,
      "beforeSql",
    );
    expect(calls).toEqual([]);
  });
});

describe("what a converter may write", () => {
  const settingsDb = () => {
    const db = new Database(":memory:");
    db.exec(
      "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, key TEXT, value TEXT, flag INTEGER)",
    );
    db.exec("INSERT INTO app_settings VALUES (1, 'invented_a', 'x', 0)");
    return db;
  };
  const writing = (set: Record<string, unknown>, id = 1): DataConverter => ({
    tables: ["app_settings"],
    runs: "afterSql",
    convert: () => ({
      updates: [{ table: "app_settings", id, set }],
      notes: [],
    }),
  });

  it.each([
    ["undefined", { value: undefined }],
    ["NaN", { value: Number.NaN }],
    ["Infinity", { value: Number.POSITIVE_INFINITY }],
    ["a Date", { value: new Date(0) }],
    ["NaN inside a JSON value", { value: { a: [1, Number.NaN] } }],
    ["undefined inside a JSON value", { value: { a: undefined } }],
  ])("refuses %s, on both dialects", async (_, set) => {
    const db = settingsDb();
    expect(() =>
      runConverterSqlite(db, { [TAG]: writing(set) }, TAG, "afterSql"),
    ).toThrow(/can't be written/);
    expect(db.prepare("SELECT value FROM app_settings").get()).toEqual({
      value: "x",
    });
    const client = {
      query: vi.fn(async () => ({ rows: [{ present: true }], rowCount: 1 })),
    };
    await expect(
      runConverterPg(client, { [TAG]: writing(set) }, TAG, "afterSql"),
    ).rejects.toThrow(/can't be written/);
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/^UPDATE/),
      expect.anything(),
    );
  });

  it("binds a boolean as 1/0 on SQLite and as itself on PostgreSQL", async () => {
    const db = settingsDb();
    runConverterSqlite(db, { [TAG]: writing({ flag: true }) }, TAG, "afterSql");
    expect(db.prepare("SELECT flag FROM app_settings").get()).toEqual({
      flag: 1,
    });
    const calls: unknown[][] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push([sql, params]);
        return { rows: [{ present: true }], rowCount: 1 };
      },
    };
    await runConverterPg(
      client,
      { [TAG]: writing({ flag: false }) },
      TAG,
      "afterSql",
    );
    expect(calls.at(-1)?.[1]).toEqual([false, 1]);
  });

  it("stops when an update changes no row or more than one", async () => {
    const db = settingsDb();
    expect(() =>
      runConverterSqlite(
        db,
        { [TAG]: writing({ value: "y" }, 9) },
        TAG,
        "afterSql",
      ),
    ).toThrow(/changed 0 rows, not 1/);
    const client = {
      query: async () => ({ rows: [{ present: true }], rowCount: 2 }),
    };
    await expect(
      runConverterPg(
        client,
        { [TAG]: writing({ value: "y" }) },
        TAG,
        "afterSql",
      ),
    ).rejects.toThrow(/changed 2 rows, not 1/);
  });
});

describe("the hook in the real SQLite migrator", () => {
  let dir: string;
  const env = { ...process.env };
  const REPO = process.cwd();
  const journalPath = () =>
    path.join(dir, "drizzle-sqlite", "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    for (const k of Object.keys(hook.converters)) delete hook.converters[k];
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-converters-"));
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

  /** An install one migration behind (no 0015), with invented settings. */
  function installBehind(): string {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.tag !== TAG);
    fs.writeFileSync(journalPath(), JSON.stringify(journal));
    runSQLite();
    const db = open();
    db.exec(
      `INSERT INTO app_settings (key, value) VALUES ('invented_a', '"x"'), ('kept_b', '"y"')`,
    );
    db.close();
    fs.writeFileSync(journalPath(), shipped);
    return shipped;
  }
  const settings = () => {
    const db = open();
    const rows = db
      .prepare(
        "SELECT key, value FROM app_settings WHERE key IN ('invented_a', 'kept_b') ORDER BY key",
      )
      .all();
    db.close();
    return rows;
  };

  it("runs in the pending loop at its phase: after the tag's SQL sees its shape", () => {
    installBehind();
    const after: ConverterTables[] = [];
    const before: ConverterTables[] = [];
    hook.converters[TAG] = marker("afterSql", after);
    hook.converters["0014_v0102_display_name_custom"] = marker(
      "beforeSql",
      before,
    );
    runSQLite();
    expect(before).toEqual([]); // 0014 was already applied
    expect(after).toHaveLength(1);
    expect(Object.keys(after[0]!).sort()).toEqual([
      "app_settings",
      "holding_observations",
    ]);
    expect(settings()).toEqual([
      { key: "invented_a", value: '"done"' },
      { key: "kept_b", value: '"y"' },
    ]);
  });

  it("runs before the SQL when asked: it still sees what the SQL drops", () => {
    installBehind();
    const db = open();
    db.exec(`
      INSERT INTO simplefin_accounts (id, external_account_id, org_name, account_name, last_balance)
        VALUES (3, 'ACT-INVENTED', 'Invented Brokerage', 'Invented IRA', '1000');
      INSERT INTO securities (id, name, kind) VALUES (7, 'Invented Fund', 'fund');
      INSERT INTO holding_observations (id, simplefin_account_id, security_id, as_of, shares, source)
        VALUES (1, 3, 7, '2026-10-30', '1', 'simplefin');
    `);
    db.close();
    const seen: ConverterTables[] = [];
    hook.converters[TAG] = marker("beforeSql", seen);
    runSQLite();
    expect(seen[0]!["holding_observations"]?.[0]).toHaveProperty(
      "performance_account_id",
    );
  });

  it("runs in the squash replay, and not on a later start", () => {
    runSQLite();
    const db = open();
    db.exec(
      `INSERT INTO app_settings (key, value) VALUES ('invented_a', '"x"'), ('kept_b', '"y"')`,
    );
    // A recorded hash that no longer matches the journal: a squash replay.
    db.exec(
      "UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM __drizzle_migrations)",
    );
    db.close();
    const seen: ConverterTables[] = [];
    hook.converters[TAG] = marker("afterSql", seen);
    runSQLite();
    expect(seen).toHaveLength(1);
    expect(settings()[0]).toEqual({ key: "invented_a", value: '"done"' });
    runSQLite(); // nothing pending: the converter doesn't run again
    expect(seen).toHaveLength(1);
  });

  it("a converter that throws rolls the whole migration back", () => {
    installBehind();
    hook.converters[TAG] = {
      ...marker("afterSql", []),
      convert: () => {
        throw new Error("invented converter failure");
      },
    };
    expect(() => runSQLite()).toThrow("invented converter failure");
    const db = open();
    const cols = (
      db.prepare("PRAGMA table_info(holding_observations)").all() as {
        name: string;
      }[]
    ).map((c) => c.name);
    const recorded = (
      db.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
        n: number;
      }
    ).n;
    db.close();
    expect(cols).toContain("performance_account_id"); // 0015 not applied
    expect(recorded).toBe(15);
    expect(settings()).toEqual([
      { key: "invented_a", value: '"x"' },
      { key: "kept_b", value: '"y"' },
    ]);
  });
});
