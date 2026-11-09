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

/**
 * Run a backup script against `dbPath` (SQLite). DATABASE_URL is set empty,
 * not unset: a set variable wins over the checkout's own `.env`.
 */
function runScript(script: string, dbPath: string, args: string[]) {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    SQLITE_PATH: dbPath,
    DATABASE_URL: "",
  };
  return spawnSync(TSX, [path.join("scripts", script), ...args], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
    timeout: 120_000,
  });
}

/**
 * Run a script (repo-relative) from `cwd`, whose `.env` holds `envFile`; the
 * database settings come from that file alone. VITEST is unset so
 * db-migrate.ts runs.
 */
function runWithEnvFile(script: string, envFile: string, args: string[]) {
  const cwd = path.join(dir, "install");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, ".env"), envFile);
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["DATABASE_URL", "SQLITE_PATH", "VITEST"]) {
    delete childEnv[name];
  }
  const tsconfig = path.join(process.cwd(), "tsconfig.json");
  const entry = path.join(process.cwd(), script);
  return spawnSync(TSX, ["--tsconfig", tsconfig, entry, ...args], {
    cwd,
    env: childEnv,
    encoding: "utf8",
    timeout: 120_000,
  });
}

/** A database that `.env` names but nothing listens on. */
const UNREACHABLE_POSTGRES =
  "postgresql://ledgr:invented-password@127.0.0.1:1/nowhere_test";

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
    expect(dryRun.stderr).toContain(`Target: SQLite ${target}`);
    expect(household(target).people).toEqual([]);

    const imported = runScript("import-backup.ts", target, [backupFile]);
    expect(imported.status, imported.stderr).toBe(0);
    expect(household(target)).toEqual(household(source));
    expect(household(target).people).toHaveLength(2);
  });
});

describe("backup CLI safety", () => {
  it("writes the backup file readable by its owner only", () => {
    const source = freshDatabase("source.db");
    const backupFile = path.join(dir, "backup.json");
    fs.writeFileSync(backupFile, "old", { mode: 0o644 });

    const exported = runScript("export-backup.ts", source, [
      "--out",
      backupFile,
    ]);
    expect(exported.status, exported.stderr).toBe(0);
    expect(fs.statSync(backupFile).mode & 0o777).toBe(0o600);
  });

  it("fails the export, naming the table, when a table can't be read", () => {
    const source = freshDatabase("source.db");
    const db = new Database(source);
    db.pragma("foreign_keys = OFF");
    db.exec(
      "DROP TABLE savings_goals; CREATE VIEW savings_goals AS SELECT json('{') AS broken",
    );
    db.close();
    const backupFile = path.join(dir, "backup.json");

    const exported = runScript("export-backup.ts", source, [
      "--out",
      backupFile,
    ]);
    expect(exported.status).toBe(1);
    expect(exported.stderr).toContain('Reading table "savings_goals" failed');
    expect(fs.existsSync(backupFile)).toBe(false);
  });

  it("exports a table this schema doesn't have yet as empty", () => {
    const source = freshDatabase("source.db");
    const db = new Database(source);
    db.pragma("foreign_keys = OFF");
    db.exec("DROP TABLE savings_goals");
    db.close();
    const backupFile = path.join(dir, "backup.json");

    const exported = runScript("export-backup.ts", source, [
      "--out",
      backupFile,
    ]);
    expect(exported.status, exported.stderr).toBe(0);
    const backup = JSON.parse(fs.readFileSync(backupFile, "utf8"));
    expect(backup.tables.savings_goals).toEqual([]);
  });

  it("reads the SQLite path from .env", () => {
    const source = freshDatabase("source.db");
    const db = new Database(source);
    db.exec(
      "INSERT INTO people (name, date_of_birth, is_primary_user) VALUES ('Robin', '1984-02-29', 1)",
    );
    db.close();
    const backupFile = path.join(dir, "backup.json");

    const exported = runWithEnvFile(
      "scripts/export-backup.ts",
      `SQLITE_PATH=${source}\n`,
      ["--out", backupFile],
    );
    expect(exported.status, exported.stderr).toBe(0);
    expect(exported.stderr).toContain("dialect: sqlite");
    const backup = JSON.parse(fs.readFileSync(backupFile, "utf8"));
    expect(backup.tables.people).toHaveLength(1);
  });

  it("export, import and migrate reach the PostgreSQL that .env names", () => {
    // The app's own variables come from the same file, as on an install.
    const envFile = [
      `DATABASE_URL=${UNREACHABLE_POSTGRES}`,
      `NEXTAUTH_SECRET=${"invented-secret-".repeat(3)}`,
    ].join("\n");
    const backupFile = path.join(dir, "backup.json");

    const exported = runWithEnvFile("scripts/export-backup.ts", envFile, [
      "--out",
      backupFile,
    ]);
    expect(exported.stderr).toContain("dialect: postgresql");
    expect(exported.stderr).toContain("ECONNREFUSED");
    expect(exported.status).toBe(1);
    expect(fs.existsSync(backupFile)).toBe(false);

    fs.writeFileSync(
      backupFile,
      JSON.stringify({ schemaVersion: "unknown", tables: {} }),
    );
    const imported = runWithEnvFile("scripts/import-backup.ts", envFile, [
      backupFile,
    ]);
    expect(imported.stderr).toContain("ECONNREFUSED");
    expect(imported.stderr).toContain(
      "Target: PostgreSQL 127.0.0.1:1/nowhere_test",
    );
    expect(imported.stderr).not.toContain("invented-password");
    expect(imported.status).toBe(1);

    const migrated = runWithEnvFile("db-migrate.ts", envFile, []);
    expect(migrated.stdout).toContain('"dialect":"postgresql"');
    expect(migrated.status).toBe(1);
  });
});
