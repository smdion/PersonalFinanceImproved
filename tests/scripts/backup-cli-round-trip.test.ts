/**
 * `pnpm backup:export` then `pnpm backup:import` on SQLite, run as the real
 * scripts in child processes: a household exported from one database
 * restores into a fresh one. The scripts aren't imported here on purpose —
 * a broken import line in a script (one once landed inside its doc
 * comment) only shows when the script itself runs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";

const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");

let dir: string;
const env = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-backup-cli-"));
  process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
  delete process.env.DATABASE_URL;
});
afterEach(() => {
  process.env = { ...env };
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh database at the current schema, through the real migrator. */
function freshDatabase(name: string): string {
  const dbPath = path.join(dir, name);
  process.env.SQLITE_PATH = dbPath;
  runSQLite();
  return dbPath;
}

/** Run a backup script against `dbPath` (SQLite: no DATABASE_URL). */
function runScript(script: string, dbPath: string, args: string[]) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, SQLITE_PATH: dbPath };
  delete childEnv.DATABASE_URL;
  return spawnSync(TSX, [path.join("scripts", script), ...args], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
    timeout: 120_000,
  });
}

function household(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return {
      people: db
        .prepare(
          "SELECT name, date_of_birth, is_primary_user FROM people ORDER BY id",
        )
        .all(),
      goals: db
        .prepare(
          "SELECT name, target_amount, priority FROM savings_goals ORDER BY id",
        )
        .all(),
    };
  } finally {
    db.close();
  }
}

describe("backup CLI round trip (SQLite)", () => {
  it("exports a household and imports it into a fresh database", () => {
    const source = freshDatabase("source.db");
    const db = new Database(source);
    db.exec(
      "INSERT INTO people (name, date_of_birth, is_primary_user) VALUES ('Robin', '1984-02-29', 1), ('Sam', '1987-11-03', 0)",
    );
    db.exec(
      "INSERT INTO savings_goals (name, target_amount, priority) VALUES ('Emergency fund', '18000.00', 1), ('Car', '9500.50', 2)",
    );
    db.close();
    const backupFile = path.join(dir, "backup.json");

    const exported = runScript("export-backup.ts", source, [
      "--out",
      backupFile,
    ]);
    expect(exported.status, exported.stderr).toBe(0);

    const target = freshDatabase("target.db");
    const dryRun = runScript("import-backup.ts", target, [
      "--dry-run",
      backupFile,
    ]);
    expect(dryRun.status, dryRun.stderr).toBe(0);
    expect(household(target).people).toEqual([]);

    const imported = runScript("import-backup.ts", target, [backupFile]);
    expect(imported.status, imported.stderr).toBe(0);
    expect(household(target)).toEqual(household(source));
    expect(household(target).people).toHaveLength(2);
  });
});
