/**
 * Migration 0016 through the real SQLite migrator: a v0.10.1/0015 install's
 * percent matches get employer_match_rate and employerMatchRate, exactly as
 * the restore step gives (match-rate-cases.ts), as a pending migration and
 * in either squash replay; a replay or a second start never divides again.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import { MATCH_RATE_TAG } from "@/lib/db/v0102-match-rate";
import { ACCOUNT_CASES, PROFILE_CASES, NOT_JSON } from "./match-rate-cases";

const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";

describe("migration 0016 through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-0016-"));
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

  /** An install at 0015 holding every shared case; the journal is then
   *  back to the shipped one, so 0016 is pending. */
  function installAt0015(): number {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    const shippedCount = journal.entries.length;
    const at = journal.entries.findIndex((e) => e.tag === MATCH_RATE_TAG);
    expect(at).toBeGreaterThan(0);
    journal.entries.splice(at);
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();
    const db = open();
    const account = db.prepare(
      `INSERT INTO contribution_accounts (id, account_type, sub_type, tax_treatment, employer_match_type, employer_match_value)
       VALUES (?, '401k', ?, 'pre_tax', ?, ?)`,
    );
    for (const c of ACCOUNT_CASES)
      account.run(c.id, c.subType ?? null, c.type, c.value);
    const profile = db.prepare(
      "INSERT INTO contribution_profiles (name, contribution_active_fields) VALUES (?, ?)",
    );
    PROFILE_CASES.forEach((c, i) =>
      profile.run(`Invented ${i}`, JSON.stringify(c.before)),
    );
    NOT_JSON.forEach((text, i) => profile.run(`Not JSON ${i}`, text));
    db.close();
    fs.writeFileSync(journalPath(), shipped);
    return shippedCount;
  }

  /** Account 7's rate, stored before 0016 by hand: one already converted. */
  function presetRates() {
    const db = open();
    for (const c of ACCOUNT_CASES)
      if (c.rate !== undefined)
        db.prepare(
          "UPDATE contribution_accounts SET employer_match_rate = ? WHERE id = ?",
        ).run(c.rate, c.id);
    db.close();
  }

  const state = () => {
    const db = open();
    const accounts = db
      .prepare(
        "SELECT id, employer_match_value AS value, employer_match_rate AS rate FROM contribution_accounts ORDER BY id",
      )
      .all() as { id: number; value: string | null; rate: string | null }[];
    const texts = (
      db
        .prepare(
          "SELECT contribution_active_fields AS f FROM contribution_profiles WHERE name LIKE 'Invented %' OR name LIKE 'Not JSON %' ORDER BY id",
        )
        .all() as { f: string }[]
    ).map((r) => r.f);
    const recorded = (
      db.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
        n: number;
      }
    ).n;
    db.close();
    return { accounts, texts, recorded };
  };

  function expectConverted(s: ReturnType<typeof state>) {
    expect(s.accounts).toEqual(
      ACCOUNT_CASES.map((c) => ({ id: c.id, value: c.value, rate: c.after })),
    );
    const profiles = s.texts.slice(0, PROFILE_CASES.length);
    expect(profiles.map((t): unknown => JSON.parse(t))).toEqual(
      PROFILE_CASES.map((c) => c.after),
    );
    expect(s.texts.slice(PROFILE_CASES.length)).toEqual(NOT_JSON);
  }

  /** 0016 adds the column, so the preset rate goes in once it exists:
   *  apply 0016 first with the converter's rows then rewound. */
  function pendingThenRewind(): number {
    const count = installAt0015();
    runSQLite();
    const db = open();
    db.exec("UPDATE contribution_accounts SET employer_match_rate = NULL");
    const profile = db.prepare(
      "UPDATE contribution_profiles SET contribution_active_fields = ? WHERE name = ?",
    );
    PROFILE_CASES.forEach((c, i) =>
      profile.run(JSON.stringify(c.before), `Invented ${i}`),
    );
    db.close();
    presetRates();
    return count;
  }

  it("converts every case as a pending migration, and a later start changes nothing", () => {
    const shippedCount = installAt0015();
    runSQLite();
    const first = state();
    expect(first.recorded).toBe(shippedCount);
    // Account 7 had no column to hold a rate before 0016: it converts too.
    const seven = ACCOUNT_CASES.find((c) => c.rate !== undefined)!;
    expect(first.accounts.find((a) => a.id === seven.id)?.rate).toBe("0.5");
    runSQLite();
    expect(state()).toEqual(first);
  });

  it("in a squash replay every case converts as on restore, and a stored rate is kept", () => {
    pendingThenRewind();
    // A replay (one recorded hash no longer matches) reruns the converter.
    const db = open();
    db.exec(
      "UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM __drizzle_migrations)",
    );
    db.close();
    runSQLite();
    expectConverted(state());
  });

  it.each([
    [
      "a recorded hash that no longer matches",
      "UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM __drizzle_migrations)",
    ],
    ["a cleared journal", "DELETE FROM __drizzle_migrations"],
  ])(
    "a squash replay (%s) twice over converted data never divides again",
    (_, damage) => {
      pendingThenRewind();
      const db0 = open();
      db0.exec(
        "UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM __drizzle_migrations)",
      );
      db0.close();
      runSQLite();
      const converted = state();
      expectConverted(converted);
      for (let run = 0; run < 2; run++) {
        const db = open();
        db.exec(damage);
        db.close();
        runSQLite();
        expect(state()).toEqual(converted);
      }
    },
  );

  it("a replay converts an install still at 0015", () => {
    installAt0015();
    const db = open();
    // 0016 isn't applied yet; a cleared journal makes the start replay all.
    db.exec("DELETE FROM __drizzle_migrations");
    db.close();
    runSQLite();
    const s = state();
    expect(s.accounts.map((a) => a.rate)).toEqual(
      ACCOUNT_CASES.map((c) => (c.rate === undefined ? c.after : "0.5")),
    );
    expect(
      s.texts.slice(0, PROFILE_CASES.length).map((t): unknown => JSON.parse(t)),
    ).toEqual(PROFILE_CASES.map((c) => c.after));
  });
});
