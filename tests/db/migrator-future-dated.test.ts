/**
 * A migration's journal `when` is the time its author generated it, not
 * the time an install applies it. The migrator records each migration it
 * applies itself (the pending loop and the squash replay) with its journal
 * `when`, the same value Drizzle's own migrator records, so Drizzle's check
 * (the latest recorded `created_at` against each entry's `when`) never sees
 * an applied migration as pending again, even on an install whose clock is
 * behind the author's, or in tests (tests/setup-clock.ts).
 *
 * Here the entry is dated a year after "now", whatever "now" is, so this
 * holds for every migration written later.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";

const TAG = "9999_future_dated_probe";
/** Applied twice, the insert fails on app_settings' key. */
const SQL = `INSERT INTO app_settings (key, value) VALUES ('future_dated_probe', '1');`;

describe("a migration dated after the clock (SQLite, real migrator)", () => {
  let dir: string;
  const env = { ...process.env };
  const REPO = process.cwd();
  const open = () => new Database(process.env.SQLITE_PATH!);
  const probes = () => {
    const db = open();
    const rows = db
      .prepare(
        "SELECT value FROM app_settings WHERE key = 'future_dated_probe'",
      )
      .all();
    db.close();
    return rows;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-future-dated-"));
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

  /** Adds the probe as the journal's last entry, dated a year from now. */
  function addFutureEntry() {
    const journalPath = path.join(
      dir,
      "drizzle-sqlite",
      "meta",
      "_journal.json",
    );
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries: Record<string, unknown>[];
    };
    const last = journal.entries[journal.entries.length - 1]!;
    journal.entries.push({
      ...last,
      idx: (last.idx as number) + 1,
      when: Date.now() + 365 * 24 * 60 * 60 * 1000,
      tag: TAG,
    });
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    fs.writeFileSync(path.join(dir, "drizzle-sqlite", `${TAG}.sql`), SQL);
    // Its schema is the last entry's: the probe changes no table.
    const meta = path.join(dir, "drizzle-sqlite", "meta");
    const snap = (i: number) =>
      path.join(meta, `${String(i).padStart(4, "0")}_snapshot.json`);
    fs.copyFileSync(snap(last.idx as number), snap((last.idx as number) + 1));
  }

  it("is applied once by the pending loop, and nothing on a later start", () => {
    runSQLite();
    addFutureEntry();
    runSQLite();
    expect(probes()).toEqual([{ value: "1" }]);
    expect(() => runSQLite()).not.toThrow();
    expect(probes()).toEqual([{ value: "1" }]);
  });

  it("is applied once by a fresh install, and nothing on a later start", () => {
    addFutureEntry();
    runSQLite();
    expect(probes()).toEqual([{ value: "1" }]);
    expect(() => runSQLite()).not.toThrow();
    expect(probes()).toEqual([{ value: "1" }]);
  });
});
