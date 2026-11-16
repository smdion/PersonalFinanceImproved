/**
 * The spouse-link tag through the real SQLite migrator: an install at the
 * tag before it gets the column with no link on any saved row, as a pending
 * migration and in either squash replay, twice over; a pair saved since
 * survives every replay; deleting a spouse unlinks the other (ON DELETE SET
 * NULL, written by hand in the SQLite tag).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";

const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";
const TAG = "0024_v0111_spouse_link";
/** Three invented adults. */
const IDS = [81, 82, 83];

describe("the spouse-link tag through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");
  const open = () => {
    const db = new Database(process.env.SQLITE_PATH!);
    db.pragma("foreign_keys = ON");
    return db;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-spouse-link-"));
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

  /** An install migrated to just before the tag, holding three people; the
   *  journal is then the shipped one, so the tag is pending. */
  function installBefore() {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === TAG);
    expect(at).toBeGreaterThan(0);
    journal.entries.splice(at);
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();
    const db = open();
    for (const id of IDS)
      db.prepare(
        "INSERT INTO people (id, name, date_of_birth, is_primary_user) VALUES (?, ?, '1970-01-01', ?)",
      ).run(id, `Invented ${id}`, id === IDS[0] ? 1 : 0);
    db.close();
    fs.writeFileSync(journalPath(), shipped);
  }

  /** The first two people linked, as the people writer saves a pair. */
  function linkPair() {
    const db = open();
    const set = db.prepare(
      "UPDATE people SET spouse_person_id = ? WHERE id = ?",
    );
    set.run(IDS[1], IDS[0]);
    set.run(IDS[0], IDS[1]);
    db.close();
  }

  const links = () => {
    const db = open();
    const got = db
      .prepare("SELECT spouse_person_id AS s FROM people ORDER BY id")
      .all() as { s: number | null }[];
    db.close();
    return got.map((r) => r.s);
  };

  it("adds the column with no link on any saved row, and a later start writes nothing", () => {
    installBefore();
    runSQLite();
    expect(links()).toEqual([null, null, null]);
    runSQLite();
    expect(links()).toEqual([null, null, null]);
  });

  it.each([
    [
      "a recorded hash that no longer matches",
      "UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM __drizzle_migrations)",
    ],
    ["a cleared journal", "DELETE FROM __drizzle_migrations"],
  ])("a squash replay (%s) twice over keeps a saved pair", (_, damage) => {
    installBefore();
    runSQLite();
    linkPair();
    for (let run = 0; run < 2; run++) {
      const db = open();
      db.exec(damage);
      db.close();
      runSQLite();
      expect(links()).toEqual([IDS[1], IDS[0], null]);
    }
  });

  it("deleting a spouse unlinks the other", () => {
    installBefore();
    runSQLite();
    linkPair();
    const db = open();
    db.prepare("DELETE FROM people WHERE id = ?").run(IDS[1]);
    db.close();
    expect(links()).toEqual([null, null]);
  });
});
