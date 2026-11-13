/**
 * The Roth-overlay tag through the real SQLite migrator: an install at the
 * tag before it keeps the Roth bracket overlay on for every saved row (an
 * empty target at the 12% it read), as a pending migration and in either
 * squash replay, twice over; a row saved since with the overlay off stays
 * off, and a later start writes nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import { ROTH_OVERLAY_TAG } from "@/lib/db/migrate/v0111-roth-overlay";
import { PERSON, ROWS } from "./roth-overlay-cases";

const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";
const BEFORE = ROWS.filter((c) => c.overlay === undefined);
const SINCE = ROWS.filter((c) => c.overlay !== undefined);

describe("the Roth-overlay tag through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-roth-overlay-"));
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

  const insertRow = (db: Database.Database, id: number, target: unknown) =>
    db
      .prepare(
        "INSERT INTO retirement_settings (id, person_id, retirement_age, end_age, return_after_retirement, annual_inflation, salary_annual_increase, roth_bracket_target) VALUES (?, ?, 60, 95, '0.05', '0.03', '0.03', ?)",
      )
      .run(id, PERSON.id, target);

  /** An install migrated to just before the tag, holding the rows saved
   *  then; the journal is then the shipped one, so the tag is pending. */
  function installBefore() {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === ROTH_OVERLAY_TAG);
    expect(at).toBeGreaterThan(0);
    journal.entries.splice(at);
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();
    const db = open();
    db.prepare(
      "INSERT INTO people (id, name, date_of_birth, is_primary_user) VALUES (?, ?, '1980-01-01', 1)",
    ).run(PERSON.id, PERSON.name);
    for (const c of BEFORE) insertRow(db, c.id, c.target);
    db.close();
    fs.writeFileSync(journalPath(), shipped);
  }

  /** Rows saved after the tag, each with its switch, as writers save them. */
  function saveSince() {
    const db = open();
    for (const c of SINCE) {
      insertRow(db, c.id, c.target);
      db.prepare(
        "UPDATE retirement_settings SET roth_bracket_overlay = ? WHERE id = ?",
      ).run(c.overlay ? 1 : 0, c.id);
    }
    db.close();
  }

  /** Each invented row's target and switch as stored. */
  const rows = () => {
    const db = open();
    const got = db
      .prepare(
        "SELECT roth_bracket_target AS target, roth_bracket_overlay AS overlay FROM retirement_settings WHERE person_id = ? ORDER BY id",
      )
      .all(PERSON.id) as { target: string; overlay: number | null }[];
    db.close();
    return got.map((r) => ({
      target: Number(r.target),
      overlay: r.overlay === null ? null : r.overlay === 1,
    }));
  };

  it("converts as a pending migration, and a later start writes nothing", () => {
    installBefore();
    runSQLite();
    expect(rows()).toEqual(BEFORE.map((c) => c.after));
    runSQLite();
    expect(rows()).toEqual(BEFORE.map((c) => c.after));
  });

  it.each([
    [
      "a recorded hash that no longer matches",
      "UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM __drizzle_migrations)",
    ],
    ["a cleared journal", "DELETE FROM __drizzle_migrations"],
  ])(
    "a squash replay (%s) twice over keeps every switch, an off one included",
    (_, damage) => {
      installBefore();
      runSQLite();
      saveSince();
      for (let run = 0; run < 2; run++) {
        const db = open();
        db.exec(damage);
        db.close();
        runSQLite();
        expect(rows()).toEqual(ROWS.map((c) => c.after));
      }
    },
  );
});
