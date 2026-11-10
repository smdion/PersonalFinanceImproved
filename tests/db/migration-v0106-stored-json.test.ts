/**
 * The v0.10.6 stored-JSON tag through the real SQLite migrator: an install
 * at the tag before it gets salary-entries-cases.ts' roots exactly as the
 * restore step stores them, as a pending migration and in either squash
 * replay, twice over, each entry read as before; an entry the entry
 * schema refuses refuses the start, and nothing changes.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { STORED_JSON_TAG } from "@/lib/db/migrate/v0106-stored-json";
import { MigrationRefusal } from "@/lib/db/migrate/converter-refusal";
import { expectSqliteReplaySafe } from "./converter-replay";
import {
  PROFILES,
  REFUSED,
  JOBS,
  SNAPSHOT_PERSON,
  profileReads,
  profileReadsBeforeTag,
  type SalaryCase,
} from "./salary-entries-cases";
import {
  ACCOUNTS,
  PROFILES as CONTRIBUTION_PROFILES,
  REFUSED as REFUSED_FIELDS,
  type ActiveFieldsCase,
} from "./active-fields-cases";
import {
  PERFORMANCE_ACCOUNTS,
  YEARS,
  yearRows,
} from "./performance-category-cases";
import { KEPT, LIMITS } from "./retired-limits-cases";

const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";

describe("the stored-JSON tag through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-stored-json-"));
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
  function installBefore(
    cases: readonly SalaryCase[] = PROFILES,
    contributions: readonly ActiveFieldsCase[] = CONTRIBUTION_PROFILES,
  ) {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === STORED_JSON_TAG);
    expect(at).toBeGreaterThan(0);
    journal.entries.splice(at);
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();
    const db = open();
    db.prepare(
      "INSERT INTO people (id, name, date_of_birth, is_primary_user) VALUES (?, ?, '1980-01-01', 1)",
    ).run(SNAPSHOT_PERSON.id, SNAPSHOT_PERSON.name);
    for (const job of JOBS)
      db.prepare(
        "INSERT INTO jobs (id, person_id, employer_name, start_date, is_speculative) VALUES (?, ?, ?, ?, 0)",
      ).run(job.id, job.person_id, job.employer_name, job.start_date);
    const salary = db.prepare(
      "INSERT INTO salary_profiles (id, name, salaries) VALUES (?, ?, ?)",
    );
    for (const c of cases)
      salary.run(c.id, `Invented ${c.id}`, JSON.stringify(c.before));
    for (const a of ACCOUNTS) {
      const cols = Object.keys(a);
      db.prepare(
        `INSERT INTO contribution_accounts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ).run(...Object.values(a).map((v) => (typeof v === "boolean" ? 1 : v)));
    }
    const profile = db.prepare(
      "INSERT INTO contribution_profiles (id, name, contribution_active_fields) VALUES (?, ?, ?)",
    );
    for (const c of contributions)
      profile.run(c.id, `Invented ${c.id}`, JSON.stringify(c.before));
    for (const row of [
      ...PERFORMANCE_ACCOUNTS.map((a) => ["performance_accounts", a] as const),
      ...yearRows().map((y) => ["account_performance", y] as const),
      ...LIMITS.map((r) => ["contribution_limits", r] as const),
    ]) {
      const cols = Object.keys(row[1]);
      db.prepare(
        `INSERT INTO ${row[0]} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ).run(...Object.values(row[1]));
    }
    db.close();
    fs.writeFileSync(journalPath(), shipped);
  }

  /** Each invented profile's root as stored. */
  const roots = () => {
    const db = open();
    const rows = db
      .prepare(
        "SELECT salaries FROM salary_profiles WHERE name LIKE 'Invented %' ORDER BY id",
      )
      .all() as { salaries: string }[];
    db.close();
    return rows.map((r): unknown => JSON.parse(r.salaries));
  };

  /** Each invented Contribution Profile's root as stored. */
  const activeRoots = () => {
    const db = open();
    const rows = db
      .prepare(
        "SELECT contribution_active_fields AS f FROM contribution_profiles WHERE name LIKE 'Invented %' ORDER BY id",
      )
      .all() as { f: string }[];
    db.close();
    return rows.map((r): unknown => JSON.parse(r.f));
  };

  /** Each invented account-year's category as stored. */
  const categories = () => {
    const db = open();
    const rows = db
      .prepare(
        "SELECT parent_category AS c FROM account_performance WHERE institution = 'Invented Bank' ORDER BY id",
      )
      .all() as { c: string }[];
    db.close();
    return rows.map((r) => r.c);
  };

  /** The invented limit rows left. */
  const limitIds = () => {
    const db = open();
    const rows = db
      .prepare("SELECT id FROM contribution_limits WHERE id >= 901 ORDER BY id")
      .all() as { id: number }[];
    db.close();
    return rows.map((r) => r.id);
  };

  const readable = PROFILES.flatMap((c, i) =>
    typeof c.before === "string" ? [] : [i],
  );

  it("converts as a pending migration, reads as before, and a later start writes nothing", () => {
    installBefore();
    runSQLite();
    const first = roots();
    expect(first).toEqual(PROFILES.map((c) => c.after));
    expect(readable.map((i) => profileReads(first[i]))).toEqual(
      readable.map((i) => profileReadsBeforeTag(PROFILES[i]!.before)),
    );
    runSQLite();
    expect(roots()).toEqual(first);
  });

  it("converts the contribution active fields as a pending migration, and a later start writes nothing", () => {
    installBefore();
    runSQLite();
    const first = activeRoots();
    expect(first).toEqual(CONTRIBUTION_PROFILES.map((c) => c.after));
    runSQLite();
    expect(activeRoots()).toEqual(first);
  });

  it("gives each account-year its account's category as a pending migration, and a later start writes nothing", () => {
    installBefore();
    runSQLite();
    expect(categories()).toEqual(YEARS.map((y) => y.after));
    runSQLite();
    expect(categories()).toEqual(YEARS.map((y) => y.after));
  });

  it("deletes the retired limits as a pending migration, keeps every other, and a later start deletes nothing", () => {
    installBefore();
    runSQLite();
    expect(limitIds()).toEqual(KEPT);
    runSQLite();
    expect(limitIds()).toEqual(KEPT);
  });

  it("a refused active-fields row refuses the start, and nothing changes", () => {
    installBefore(PROFILES, [...CONTRIBUTION_PROFILES, ...REFUSED_FIELDS]);
    const before = [roots(), activeRoots()];
    expect(() => runSQLite()).toThrow(
      /contribution_profiles 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512/,
    );
    expect([roots(), activeRoots()]).toEqual(before);
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
    const converted = roots();
    for (let run = 0; run < 2; run++) {
      const db = open();
      db.exec(damage);
      db.close();
      runSQLite();
      expect(roots()).toEqual(converted);
      expect(activeRoots()).toEqual(CONTRIBUTION_PROFILES.map((c) => c.after));
    }
  });

  it("run twice more over its own output, it writes nothing", () => {
    installBefore();
    runSQLite();
    const db = open();
    expectSqliteReplaySafe(db, tagConverters(STORED_JSON_TAG));
    db.close();
  });

  it("an entry the schema refuses refuses the start, and the whole tag rolls back", () => {
    installBefore([...PROFILES, ...REFUSED]);
    const before = roots();
    expect(() => runSQLite()).toThrow(MigrationRefusal);
    expect(() => runSQLite()).toThrow(
      /salary_profiles 301, 302, 303, 304, 305, 306, 307/,
    );
    const db = open();
    const recorded = db
      .prepare("SELECT count(*) AS n FROM __drizzle_migrations")
      .get() as { n: number };
    db.close();
    const shipped = JSON.parse(fs.readFileSync(journalPath(), "utf8")) as {
      entries: { tag: string }[];
    };
    expect(recorded.n).toBe(
      shipped.entries.findIndex((e) => e.tag === STORED_JSON_TAG),
    );
    expect(roots()).toEqual(before);
  });
});
