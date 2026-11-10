/**
 * Migration 0017 through the real SQLite migrator: an install at 0016 keeps
 * each percent match's rate alone, exactly as the restore step gives
 * (match-value-cases.ts), as a pending migration and in either squash
 * replay; a replay or a second start clears nothing twice. M12: an install
 * at 0015 with 0016 and 0017 both pending ends where the restore ladder
 * ends for the same rows.
 */
import { STORED_JSON_TAG } from "@/lib/db/migrate/v0106-stored-json";
import { journalBefore } from "./journal-before";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import { MATCH_RATE_TAG } from "@/lib/db/migrate/v0102-match-rate";
import { MATCH_VALUE_TAG } from "@/lib/db/migrate/v0102-match-value";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import { VALUE_ACCOUNTS, VALUE_PROFILES } from "./match-value-cases";
import { ACCOUNT_CASES, PROFILE_CASES } from "./match-rate-cases";

// These cases hold shapes the stored-JSON tag refuses by design (tested in
// its own files): the restore here runs the converters before it.
vi.mock("@/lib/db/migrate/v0106-stored-json", async (original) => ({
  ...(await original<typeof import("@/lib/db/migrate/v0106-stored-json")>()),
  STORED_JSON_CONVERTERS: {},
}));

const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";

describe("migration 0017 through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-0017-"));
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

  /** An install migrated to just before `tag`, holding `seed`'s rows; the
   *  journal is then the shipped one before the stored-JSON tag, so `tag` on is pending. */
  function installBefore(tag: string, seed: (db: Database.Database) => void) {
    const shipped = journalBefore(
      fs.readFileSync(journalPath(), "utf8"),
      STORED_JSON_TAG,
    );
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === tag);
    expect(at).toBeGreaterThan(0);
    journal.entries.splice(at);
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();
    const db = open();
    seed(db);
    db.close();
    fs.writeFileSync(journalPath(), shipped);
    return (JSON.parse(shipped) as { entries: unknown[] }).entries.length;
  }

  const installAt0016 = () =>
    installBefore(MATCH_VALUE_TAG, (db) => {
      const account = db.prepare(
        `INSERT INTO contribution_accounts (id, account_type, tax_treatment, employer_match_type, employer_match_value, employer_match_rate)
         VALUES (?, '401k', 'pre_tax', ?, ?, ?)`,
      );
      for (const c of VALUE_ACCOUNTS)
        account.run(c.id, c.type, c.value, c.rate);
      const profile = db.prepare(
        "INSERT INTO contribution_profiles (name, contribution_active_fields) VALUES (?, ?)",
      );
      VALUE_PROFILES.forEach((c, i) =>
        profile.run(`Invented ${i}`, JSON.stringify(c.before)),
      );
    });

  const state = () => {
    const db = open();
    const accounts = db
      .prepare(
        "SELECT id, employer_match_value AS value, employer_match_rate AS rate FROM contribution_accounts ORDER BY id",
      )
      .all() as { id: number; value: string | null; rate: string | null }[];
    const profiles = (
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
    return { accounts, profiles, recorded };
  };

  function expectCleared(s: ReturnType<typeof state>) {
    expect(s.accounts).toEqual(
      VALUE_ACCOUNTS.map((c) => ({ id: c.id, value: c.after, rate: c.rate })),
    );
    expect(s.profiles).toEqual(VALUE_PROFILES.map((c) => c.after));
  }

  it("clears every case as a pending migration, and a later start changes nothing", () => {
    const shippedCount = installAt0016();
    runSQLite();
    const first = state();
    expectCleared(first);
    expect(first.recorded).toBe(shippedCount);
    runSQLite();
    expect(state()).toEqual(first);
  });

  it.each([
    [
      "a recorded hash that no longer matches",
      "UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM __drizzle_migrations)",
    ],
    ["a cleared journal", "DELETE FROM __drizzle_migrations"],
  ])(
    "a squash replay (%s) twice over cleared data changes nothing",
    (_, damage) => {
      installAt0016();
      runSQLite();
      const cleared = state();
      expectCleared(cleared);
      for (let run = 0; run < 2; run++) {
        const db = open();
        db.exec(damage);
        db.close();
        runSQLite();
        expect(state()).toEqual(cleared);
      }
    },
  );

  it("M12: from 0015, 0016 then 0017 end where the restore ladder ends", () => {
    installBefore(MATCH_RATE_TAG, (db) => {
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
    });
    runSQLite();
    const { tables } = transformBackupToCurrentSchema(
      {
        contribution_accounts: ACCOUNT_CASES.map((c) => ({
          id: c.id,
          employer_match_type: c.type,
          employer_match_value: c.value,
        })),
        contribution_profiles: PROFILE_CASES.map((c, i) => ({
          id: i + 1,
          contribution_active_fields: structuredClone(c.before),
        })),
      },
      "0015_v0102_dead_data",
      MATCH_VALUE_TAG,
    );
    const restored = tables as Record<string, Record<string, unknown>[]>;
    const s = state();
    expect(s.accounts).toEqual(
      restored["contribution_accounts"]!.map((a) => ({
        id: a["id"],
        value: a["employer_match_value"] ?? null,
        rate: a["employer_match_rate"] ?? null,
      })),
    );
    expect(s.profiles).toEqual(
      restored["contribution_profiles"]!.map(
        (p) => p["contribution_active_fields"],
      ),
    );
    runSQLite();
    expect(state()).toEqual(s);
  });
});
