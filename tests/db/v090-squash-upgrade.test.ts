/**
 * The v0.9.0 squash on SQLite, end to end through the real migrator
 * (runSQLite): a fresh install, a v0.8.15 install (13 v0.8 journal rows),
 * a journal cleared by a failed run, and an install older than v0.8.14 —
 * which must be refused before any backup or change.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  runSQLite,
  schemaLabel,
  SQUASHED_LINE_TIP,
  UpgradePathError,
} from "../../db-migrate";

const FOLDER = "drizzle-sqlite";
const journal = JSON.parse(
  fs.readFileSync(path.join(FOLDER, "meta", "_journal.json"), "utf8"),
) as { entries: { idx: number; tag: string }[] };
const hashOf = (tag: string) =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(FOLDER, `${tag}.sql`), "utf8"))
    .digest("hex");

function exec(db: Database.Database, tag: string) {
  const sql = fs.readFileSync(path.join(FOLDER, `${tag}.sql`), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint"))
    if (stmt.trim()) db.exec(stmt);
}

let dir: string;
let dbPath: string;
const env = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-squash-"));
  dbPath = path.join(dir, "ledgr.db");
  process.env.SQLITE_PATH = dbPath;
  process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
  delete process.env.LEDGR_SKIP_PREMIGRATION_BACKUP;
});
afterEach(() => {
  process.env = { ...env };
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A database at the v0.8.15 schema (the baseline) with a household row and
 *  `rows` fake v0.8 journal rows (hashes v0.9 doesn't know). */
function v0815(rows: number, mutate?: (db: Database.Database) => void) {
  const db = new Database(dbPath);
  exec(db, "0000_v9_initial_schema");
  db.exec(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
  );
  for (let i = 0; i < rows; i++)
    db.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    ).run(`v08-${i}`, String(i));
  db.exec(
    "INSERT INTO people (id, name, date_of_birth) VALUES (1, 'Alex', '1990-01-01')",
  );
  mutate?.(db);
  db.close();
}

const read = () => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return {
      hashes: (
        db
          .prepare("SELECT hash FROM __drizzle_migrations ORDER BY id")
          .all() as {
          hash: string;
        }[]
      ).map((r) => r.hash),
      people: (
        db.prepare("SELECT count(*) AS n FROM people").get() as { n: number }
      ).n,
      hasDebts: !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE name = 'debts'")
        .get(),
    };
  } finally {
    db.close();
  }
};
const backups = () =>
  fs.existsSync(process.env.LEDGR_BACKUP_DIR!)
    ? fs
        .readdirSync(process.env.LEDGR_BACKUP_DIR!)
        .filter((f) => f.startsWith("pre-upgrade-backup-"))
    : [];
const allHashes = journal.entries.map((e) => hashOf(e.tag));

describe("v0.9.0 squash (SQLite, real migrator)", () => {
  it("a fresh install records exactly the five journal entries, no backup", () => {
    runSQLite();
    expect(read().hashes).toEqual(allHashes);
    expect(backups()).toEqual([]);
  });

  it("a v0.8.15 install (13 journal rows) squashes to five, keeps its data, backs up first", () => {
    v0815(13);
    runSQLite();
    const after = read();
    expect(after.hashes).toEqual(allHashes);
    expect(after.people).toBe(1);
    expect(after.hasDebts).toBe(true);
    expect(backups()).toHaveLength(1);
    // A second start changes nothing.
    runSQLite();
    expect(read().hashes).toEqual(allHashes);
    expect(backups()).toHaveLength(1);
  });

  it("a journal cleared by an earlier failed run recovers, with a backup", () => {
    v0815(0);
    runSQLite();
    expect(read().hashes).toEqual(allHashes);
    expect(backups()).toHaveLength(1);
  });

  it("an install older than v0.8.14 is refused — journal, schema and data untouched, no backup", () => {
    v0815(13, (db) =>
      db.exec("ALTER TABLE account_performance DROP COLUMN note"),
    );
    expect(() => runSQLite()).toThrow(UpgradePathError);
    expect(() => runSQLite()).toThrow(/update to v0\.8\.15 first/);
    const after = read();
    expect(after.hashes).toHaveLength(13);
    expect(after.hasDebts).toBe(false);
    expect(after.people).toBe(1);
    expect(backups()).toEqual([]);
  });
});

describe("schemaLabel — what a pre-squash backup is labelled", () => {
  const columns = (build: (db: Database.Database) => void) => {
    const db = new Database(":memory:");
    build(db);
    const m = new Map<string, Set<string>>();
    for (const r of db
      .prepare(
        "SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'",
      )
      .all() as { t: string; c: string }[]) {
      if (!m.has(r.t)) m.set(r.t, new Set());
      m.get(r.t)!.add(r.c);
    }
    db.close();
    return m;
  };
  const baselineOnly = columns((db) => exec(db, "0000_v9_initial_schema"));
  const allApplied = columns((db) => {
    for (const e of journal.entries) exec(db, e.tag);
  });

  it("v0.8.15 (no v0.9 hash recorded, baseline schema) → the squashed line's tip", () => {
    expect(schemaLabel(journal, FOLDER, new Set(), baselineOnly, crypto)).toBe(
      SQUASHED_LINE_TIP,
    );
  });

  it("a dev database on the v0.9 migrations → the last one recorded", () => {
    expect(
      schemaLabel(
        journal,
        FOLDER,
        new Set([hashOf("0004_v090_debts")]),
        allApplied,
        crypto,
      ),
    ).toBe("0004_v090_debts");
  });

  it("nothing recorded but the v0.9 columns present → by shape", () => {
    // The newest migration whose tables and columns match. 0005 only drops
    // a NOT NULL (no column of its own), so the shape reads as 0005 — a
    // label, not a record of what ran.
    expect(schemaLabel(journal, FOLDER, new Set(), allApplied, crypto)).toBe(
      "0005_v092_filing_status_auto",
    );
  });
});
