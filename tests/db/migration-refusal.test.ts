/**
 * A converter's refusal to start (MigrationRefusal): its message names row
 * ids and field names, never a value, and says nothing was changed; thrown
 * by the second converter of a tag, it rolls back the first one's writes
 * and every other pending tag in the real SQLite migrator, stops the
 * PostgreSQL runner before that converter writes, and fails a restore.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { DataConverter } from "@/lib/db/migrate/migration-converters";
import { MigrationRefusal } from "@/lib/db/migrate/converter-refusal";
import { over, renames } from "./converter-list-cases";

const hook = vi.hoisted(() => ({
  converters: {} as Record<string, DataConverter | DataConverter[]>,
}));
vi.mock("@/lib/db/migrate/migration-converters", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MIGRATION_CONVERTERS: hook.converters,
}));

import {
  convertBackupInOrder,
  runConverterPg,
} from "@/lib/db/migrate/migration-converters";
import { runSQLite } from "../../db-migrate";

const TAG = "0015_v0102_dead_data";
const SECRET = "invented-secret-value";

/** Refuses every `retired_*` row, naming its id and one field. */
const refuses = over((rows) => {
  const ids = rows.filter((r) => r.key.startsWith("retired_")).map((r) => r.id);
  if (ids.length > 0)
    throw new MigrationRefusal({
      problem: "Invented rows can't be converted",
      refused: { app_settings: ids },
      fields: ["value"],
      fix: "Change them in the previous version, then upgrade again.",
    });
  return { updates: [] };
});

describe("MigrationRefusal's message", () => {
  it("names sorted ids per table and field names, then the way out", () => {
    const e = new MigrationRefusal({
      problem: "Invented rows can't be converted",
      refused: { salary_profiles: [5, 3, 5], jobs: [2], empty: [] },
      fields: ["allocationPriority", SECRET, "has space", "allocationPriority"],
      fix: "Re-save them in the previous version.",
    });
    expect(e.message).toBe(
      "Invented rows can't be converted (rows: salary_profiles 3, 5; jobs 2; fields: allocationPriority). Nothing was changed. Re-save them in the previous version.",
    );
    expect(e.refused).toEqual({
      salary_profiles: [5, 3, 5],
      jobs: [2],
      empty: [],
    });
    expect(e.fields).toEqual(["allocationPriority"]);
  });

  it("counts ids past fifty, and takes no row ids but integers", () => {
    const ids = Array.from({ length: 53 }, (_, i) => i + 1);
    const e = new MigrationRefusal({
      problem: "Too many",
      refused: { t: ids },
      fix: "Fix them.",
    });
    expect(e.message).toContain("49, 50 and 3 more)");
    expect(
      () =>
        new MigrationRefusal({
          problem: "p",
          refused: { t: [1.5] },
          fix: "f",
        }),
    ).toThrow(/row ids only/);
  });

  it("with no rows, says only the problem and the way out", () => {
    expect(
      new MigrationRefusal({ problem: "No key", fix: "Set it." }).message,
    ).toBe("No key. Nothing was changed. Set it.");
  });
});

describe("a refusal stops the run before the refusing converter writes", () => {
  it("PostgreSQL runner: no write of the refusing converter is sent", async () => {
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.startsWith("SELECT to_regclass"))
          return { rows: [{ present: true }] };
        if (sql.startsWith("SELECT *"))
          return {
            rows: [
              { id: 1, key: "invented_a", value: SECRET },
              { id: 2, key: "retired_b", value: SECRET },
            ],
          };
        return { rows: [], rowCount: 1 };
      },
    };
    const run = runConverterPg(
      client,
      { [TAG]: [refuses, renames] },
      TAG,
      "afterSql",
    );
    await expect(run).rejects.toThrow(MigrationRefusal);
    await expect(run).rejects.toThrow(/app_settings 2\b/);
    expect(calls.filter((s) => !s.startsWith("SELECT"))).toEqual([]);
  });

  it("the restore step: the refusal fails the restore, naming no value", () => {
    const tables = {
      app_settings: [
        { id: 1, key: "invented_a", value: SECRET },
        { id: 2, key: "retired_b", value: SECRET },
      ],
    };
    const restore = () =>
      convertBackupInOrder(tables, { [TAG]: [renames, refuses] });
    expect(restore).toThrow(MigrationRefusal);
    expect(restore).not.toThrow(new RegExp(SECRET));
  });
});

describe("a refusal in the real SQLite migrator", () => {
  let dir: string;
  const env = { ...process.env };
  const REPO = process.cwd();
  const journalPath = () =>
    path.join(dir, "drizzle-sqlite", "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    for (const k of Object.keys(hook.converters)) delete hook.converters[k];
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-refusal-"));
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
  function installBehind(): number {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    journal.entries = journal.entries.slice(
      0,
      journal.entries.findIndex((e) => e.tag === TAG),
    );
    fs.writeFileSync(journalPath(), JSON.stringify(journal));
    runSQLite();
    const db = open();
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('invented_a', ?), ('retired_b', ?)",
    ).run(JSON.stringify(SECRET), JSON.stringify(SECRET));
    db.close();
    fs.writeFileSync(journalPath(), shipped);
    return journal.entries.length;
  }
  const state = () => {
    const db = open();
    const settings = db
      .prepare(
        "SELECT key FROM app_settings WHERE key NOT IN ('pre_upgrade_backup') ORDER BY key",
      )
      .all();
    const recorded = (
      db.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
        n: number;
      }
    ).n;
    const cols = (
      db.prepare("PRAGMA table_info(holding_observations)").all() as {
        name: string;
      }[]
    ).map((c) => c.name);
    db.close();
    return { settings, recorded, cols };
  };

  it("rolls back the tag's earlier converter and every pending tag", () => {
    const applied = installBehind();
    const before = state();
    hook.converters[TAG] = [renames, refuses];
    let thrown: unknown;
    try {
      runSQLite();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(MigrationRefusal);
    expect((thrown as Error).message).toMatch(
      /^Invented rows can't be converted \(rows: app_settings \d+; fields: value\)\. Nothing was changed\./,
    );
    expect((thrown as Error).message).not.toContain(SECRET);
    const after = state();
    expect(after).toEqual(before);
    expect(after.recorded).toBe(applied);
    expect(after.settings).toContainEqual({ key: "invented_a" });
    expect(after.cols).toContain("performance_account_id"); // 0015 not applied
  });

  it("a squash replay refused leaves the database as it was", () => {
    runSQLite();
    const db = open();
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('invented_a', ?), ('retired_b', ?)",
    ).run(JSON.stringify(SECRET), JSON.stringify(SECRET));
    db.exec("DELETE FROM __drizzle_migrations");
    db.close();
    const before = state();
    hook.converters[TAG] = [renames, refuses];
    expect(() => runSQLite()).toThrow(MigrationRefusal);
    expect(state()).toEqual(before);
  });
});
