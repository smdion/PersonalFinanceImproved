/**
 * Migration 0014 renames `displayNameActive` to `displayNameCustom` in
 * stored Contribution Profile entries on SQLite, exactly as the restore
 * step does for an older backup, and a second run changes nothing. The
 * PostgreSQL file runs the same cases in migration-0014-postgres.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import { renameDisplayNameActive } from "@/lib/db/migrate/v0102-display-name-custom";
import { RENAME_CASES } from "./display-name-custom-cases";

const TAG = "0014_v0102_display_name_custom";
const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";
const sql = fs.readFileSync(path.join(REPO, FOLDER, `${TAG}.sql`), "utf8");

function exec(db: Database.Database) {
  for (const stmt of sql.split("--> statement-breakpoint"))
    if (stmt.trim()) db.exec(stmt);
}

const read = (db: Database.Database) =>
  (
    db
      .prepare(
        "SELECT contribution_active_fields AS f FROM contribution_profiles ORDER BY id",
      )
      .all() as { f: string }[]
  ).map((r): unknown => JSON.parse(r.f));

describe("migration 0014 on SQLite", () => {
  function profiles(values: unknown[]) {
    const db = new Database(":memory:");
    // The live column (drizzle-sqlite/0000): JSON text, never SQL NULL.
    db.exec(
      "CREATE TABLE contribution_profiles (id integer primary key, contribution_active_fields text DEFAULT '{}' NOT NULL)",
    );
    const ins = db.prepare(
      "INSERT INTO contribution_profiles (contribution_active_fields) VALUES (?)",
    );
    for (const v of values) ins.run(JSON.stringify(v));
    return db;
  }

  for (const c of RENAME_CASES)
    it(`${c.name}, and again on a second run`, () => {
      const db = profiles([c.before]);
      exec(db);
      expect(read(db)).toEqual([c.after]);
      exec(db);
      expect(read(db)).toEqual([c.after]);
    });

  it("gives what the restore step gives, all cases in one table", () => {
    const db = profiles(RENAME_CASES.map((c) => c.before));
    exec(db);
    const tables = {
      contribution_profiles: RENAME_CASES.map((c, i) => ({
        id: i + 1,
        contribution_active_fields: JSON.stringify(c.before),
      })),
    };
    renameDisplayNameActive(tables);
    const restored = tables.contribution_profiles.map((r) =>
      typeof r.contribution_active_fields === "string"
        ? JSON.parse(r.contribution_active_fields)
        : r.contribution_active_fields,
    );
    expect(read(db)).toEqual(restored);
    expect(restored).toEqual(RENAME_CASES.map((c) => c.after));
  });

  it("leaves text that isn't JSON alone and still converts the other rows", () => {
    const convertible = RENAME_CASES[0]!;
    const notJson = [
      "not json",
      "{contributionAccounts: {'1': {displayNameActive: 'JSON5'}}}",
      '{"contributionAccounts": {"1": {"displayNameActive": "cut',
    ];
    const db = profiles([convertible.before]);
    const ins = db.prepare(
      "INSERT INTO contribution_profiles (contribution_active_fields) VALUES (?)",
    );
    for (const text of notJson) ins.run(text);
    ins.run(JSON.stringify(convertible.before));
    const rows = () =>
      (
        db
          .prepare(
            "SELECT contribution_active_fields AS f FROM contribution_profiles ORDER BY id",
          )
          .all() as { f: string }[]
      ).map((r) => r.f);
    for (let run = 0; run < 2; run++) {
      exec(db);
      const [first, ...rest] = rows();
      expect(JSON.parse(first!)).toEqual(convertible.after);
      expect(JSON.parse(rest.at(-1)!)).toEqual(convertible.after);
      expect(rest.slice(0, -1)).toEqual(notJson);
      expect(rest).toHaveLength(notJson.length + 1);
    }
  });
});

describe("migration 0014 through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-0014-"));
    fs.cpSync(path.join(REPO, FOLDER), path.join(dir, FOLDER), {
      recursive: true,
    });
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

  it("converts a v0.10.1 install's profiles as a pending migration", () => {
    // Install at 0013 (v0.10.1): the journal up to 0014.
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    const shippedCount = journal.entries.length;
    const at = journal.entries.findIndex((e) => e.tag === TAG);
    expect(at).toBeGreaterThan(0);
    journal.entries.splice(at);
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();

    let db = new Database(process.env.SQLITE_PATH!);
    const ins = db.prepare(
      "INSERT INTO contribution_profiles (name, contribution_active_fields) VALUES (?, ?)",
    );
    RENAME_CASES.forEach((c, i) =>
      ins.run(`Invented ${i}`, JSON.stringify(c.before)),
    );
    db.close();

    fs.writeFileSync(journalPath(), shipped);
    runSQLite();
    db = new Database(process.env.SQLITE_PATH!, { readonly: true });
    const rows = (
      db
        .prepare(
          "SELECT contribution_active_fields AS f FROM contribution_profiles WHERE name LIKE 'Invented %' ORDER BY id",
        )
        .all() as { f: string }[]
    ).map((r): unknown => JSON.parse(r.f));
    const recorded = (
      db.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
        n: number;
      }
    ).n;
    db.close();
    expect(rows).toEqual(RENAME_CASES.map((c) => c.after));
    expect(recorded).toBe(shippedCount);
  });
});
