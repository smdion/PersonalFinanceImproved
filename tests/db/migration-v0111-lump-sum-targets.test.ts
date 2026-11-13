/**
 * The lump-sum-targets tag through the real SQLite migrator: an install at
 * the tag before it gains the account id beside each saved lump sum's name
 * that matches one account, and keeps every other lump sum as stored, as a
 * pending migration and in either squash replay, twice over; a later start
 * writes nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import { LUMP_SUM_TARGETS_TAG } from "@/lib/db/migrate/v0111-lump-sum-targets";
import { SETS, seedStatements } from "./lump-sum-targets-cases";

const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";

describe("the lump-sum-targets tag through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    dir = fs.mkdtempSync(
      path.join(tmpdir(), "ledgr-migration-lump-sum-targets-"),
    );
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

  /** An install migrated to just before the tag, holding the cases' rows;
   *  the journal is then the shipped one, so the tag is pending. */
  function installBefore() {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === LUMP_SUM_TARGETS_TAG);
    expect(at).toBeGreaterThan(0);
    journal.entries.splice(at);
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();
    const db = open();
    for (const [sql, params] of seedStatements())
      db.prepare(sql).run(...params);
    db.close();
    fs.writeFileSync(journalPath(), shipped);
  }

  /** Each invented saved set's root as stored. */
  const roots = () => {
    const db = open();
    const rows = db
      .prepare(
        "SELECT overrides FROM projection_overrides WHERE id >= 701 ORDER BY id",
      )
      .all() as { overrides: string }[];
    db.close();
    return rows.map((r): unknown => JSON.parse(r.overrides));
  };

  it("converts as a pending migration, and a later start writes nothing", () => {
    installBefore();
    runSQLite();
    expect(roots()).toEqual(SETS.map((c) => c.after));
    runSQLite();
    expect(roots()).toEqual(SETS.map((c) => c.after));
  });

  it.each([
    [
      "a recorded hash that no longer matches",
      "UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM __drizzle_migrations)",
    ],
    ["a cleared journal", "DELETE FROM __drizzle_migrations"],
  ])("a squash replay (%s) twice over writes nothing", (_, damage) => {
    installBefore();
    runSQLite();
    for (let run = 0; run < 2; run++) {
      const db = open();
      db.exec(damage);
      db.close();
      runSQLite();
      expect(roots()).toEqual(SETS.map((c) => c.after));
    }
  });
});
