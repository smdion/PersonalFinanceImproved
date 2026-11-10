/**
 * The v0.10.6 money tag through the real SQLite migrator: an install at
 * the tag before it gets the per-person retirement rows of
 * retirement-people-cases.ts, exactly as the restore step gives them, as a
 * pending migration and in either squash replay, twice over; every reader
 * reads each person as before; every budget item's amounts get one
 * number per column (budget-amounts-cases.ts), and every unread rule
 * snapshot goes (net-pay-snapshot-cases.ts), each read as before; a
 * routing that still pays from its snapshot refuses, and nothing changes.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import {
  MONEY_TAG,
  RETIREMENT_PEOPLE_CONVERTER,
} from "@/lib/db/migrate/v0106-retirement-people";
import { BUDGET_AMOUNTS_CONVERTER } from "@/lib/db/migrate/v0106-budget-amounts";
import { NET_PAY_SNAPSHOT_CONVERTER } from "@/lib/db/migrate/v0106-net-pay-snapshot";
import { MigrationRefusal } from "@/lib/db/migrate/converter-refusal";
import {
  JOBS,
  PROFILES as SALARY_PROFILES,
  REFUSED,
  SPECULATIVE_JOB,
  profileReads,
  type ProfileCase,
} from "./net-pay-snapshot-cases";
import { expectSqliteReplaySafe } from "./converter-replay";
import {
  ITEMS,
  PROFILES as BUDGETS,
  asReadBeforeTag,
  reads as budgetReads,
} from "./budget-amounts-cases";
import {
  ADDED,
  HELD,
  PEOPLE,
  PROFILES,
  SETTINGS,
  reads,
  settingsBeforeTag,
  type PersonRow,
  type Settings,
} from "./retirement-people-cases";

const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";

/** A table's rows ordered by id, as the cases hold them. */
const all = <T>(db: Database.Database, table: string) =>
  db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as T[];

const PERSON_COLUMNS =
  "id, profile_id, person_id, retirement_age, end_age, social_security_monthly, social_security_pia, ss_start_age, rule_of_55_override, salary_annual_increase";

/** SQLite's 0/1 as the cases' booleans, its numeric text as the cases' text. */
const personRows = (db: Database.Database) =>
  (
    db
      .prepare(
        `SELECT ${PERSON_COLUMNS} FROM retirement_profile_people ORDER BY id`,
      )
      .all() as PersonRow[]
  ).map((r) => ({
    ...r,
    rule_of_55_override:
      r.rule_of_55_override == null ? null : Boolean(r.rule_of_55_override),
  }));

describe("the money tag through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-money-"));
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

  /** An install migrated to just before the money tag, holding the cases'
   *  rows; the journal is then the shipped one, so the tag is pending. */
  function installBefore(
    salaryProfiles: readonly ProfileCase[] = SALARY_PROFILES,
  ) {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === MONEY_TAG);
    expect(at).toBeGreaterThan(0);
    journal.entries.splice(at);
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();
    const db = open();
    const person = db.prepare(
      "INSERT INTO people (id, name, date_of_birth, is_primary_user) VALUES (?, ?, '1980-01-01', ?)",
    );
    for (const p of PEOPLE) person.run(p.id, p.name, p.is_primary_user ? 1 : 0);
    const profile = db.prepare(
      "INSERT INTO retirement_profiles (id, name) VALUES (?, ?)",
    );
    for (const p of PROFILES) profile.run(p.id, p.name);
    const settings = db.prepare(
      `INSERT INTO retirement_settings (id, person_id, profile_id, retirement_age, end_age, return_after_retirement, annual_inflation, salary_annual_increase, social_security_monthly, ss_start_age, rule_of_55_override)
       VALUES (?, ?, ?, ?, ?, '0.05', '0.03', ?, ?, ?, ?)`,
    );
    for (const s of SETTINGS)
      settings.run(
        s.id,
        s.person_id,
        s.profile_id,
        s.retirement_age,
        s.end_age,
        s.salary_annual_increase,
        s.social_security_monthly,
        s.ss_start_age,
        s.rule_of_55_override ? 1 : 0,
      );
    const held = db.prepare(
      `INSERT INTO retirement_profile_people (${PERSON_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of HELD)
      held.run(
        r.id,
        r.profile_id,
        r.person_id,
        r.retirement_age,
        r.end_age,
        r.social_security_monthly,
        r.social_security_pia,
        r.ss_start_age,
        r.rule_of_55_override == null ? null : r.rule_of_55_override ? 1 : 0,
        r.salary_annual_increase,
      );
    const budget = db.prepare(
      "INSERT INTO budget_profiles (id, name, column_labels) VALUES (?, ?, ?)",
    );
    for (const b of BUDGETS)
      budget.run(b.id, b.name, JSON.stringify(b.column_labels));
    const item = db.prepare(
      "INSERT INTO budget_items (id, profile_id, category, subcategory, amounts) VALUES (?, ?, 'Invented', ?, ?)",
    );
    for (const c of ITEMS)
      item.run(c.id, c.profile_id, `Item ${c.id}`, JSON.stringify(c.before));
    const job = db.prepare(
      "INSERT INTO jobs (id, person_id, employer_name, start_date, end_date, is_speculative) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const j of [...JOBS, SPECULATIVE_JOB])
      job.run(
        j.id,
        j.person_id,
        j.employer_name,
        j.start_date,
        j.end_date,
        j.is_speculative ? 1 : 0,
      );
    const salary = db.prepare(
      "INSERT INTO salary_profiles (id, name, salaries) VALUES (?, ?, ?)",
    );
    for (const c of salaryProfiles)
      salary.run(c.id, `Invented ${c.id}`, JSON.stringify(c.before));
    db.close();
    fs.writeFileSync(journalPath(), shipped);
  }

  /** The per-person rows, and what every reader reads from them (a squash
   *  replay re-runs older tags' own conversions on other columns). */
  const state = (
    read = reads,
    budgetView: typeof asReadBeforeTag = (i) => [...i],
  ) => {
    const db = open();
    const tables = {
      people: all<(typeof PEOPLE)[number]>(db, "people"),
      retirement_settings: all<Settings>(db, "retirement_settings"),
      retirement_profile_people: personRows(db),
    };
    const items = (
      db
        .prepare("SELECT profile_id, amounts FROM budget_items ORDER BY id")
        .all() as { profile_id: number; amounts: string }[]
    ).map((r) => ({
      profile_id: r.profile_id,
      amounts: JSON.parse(r.amounts) as unknown[],
    }));
    const salaries = (
      db
        .prepare(
          "SELECT salaries FROM salary_profiles WHERE name LIKE 'Invented %' ORDER BY id",
        )
        .all() as {
        salaries: string;
      }[]
    ).map((r): unknown => JSON.parse(r.salaries));
    db.close();
    return {
      rows: tables.retirement_profile_people,
      reads: read(tables),
      amounts: items.map((i) => i.amounts),
      budget: budgetReads(budgetView(items)),
      salaries,
    };
  };

  function expectAdded(s: ReturnType<typeof state>) {
    expect(s.rows).toEqual([
      ...HELD,
      ...ADDED.map((r, i) => ({ ...r, id: HELD.length + 1 + i })),
    ]);
    expect(s.amounts).toEqual(ITEMS.map((c) => c.after));
    expect(s.salaries).toEqual(SALARY_PROFILES.map((c) => c.after));
  }

  it("adds the rows as a pending migration, reads as before, and a later start adds none", () => {
    installBefore();
    const before = state((t) => reads(t, settingsBeforeTag), asReadBeforeTag);
    runSQLite();
    const first = state();
    expectAdded(first);
    expect(first.reads).toEqual(before.reads);
    expect(first.budget).toEqual(before.budget);
    expect(first.salaries.map(profileReads)).toEqual(
      before.salaries.map(profileReads),
    );
    runSQLite();
    expect(state()).toEqual(first);
  });

  it.each([
    [
      "a recorded hash that no longer matches",
      "UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM __drizzle_migrations)",
    ],
    ["a cleared journal", "DELETE FROM __drizzle_migrations"],
  ])("a squash replay (%s) twice over adds nothing", (_, damage) => {
    installBefore();
    runSQLite();
    const added = state();
    expectAdded(added);
    for (let run = 0; run < 2; run++) {
      const db = open();
      db.exec(damage);
      db.close();
      runSQLite();
      expect(state()).toEqual(added);
    }
  });

  it("run twice more over its own output, it writes nothing", () => {
    installBefore();
    runSQLite();
    const db = open();
    expectSqliteReplaySafe(db, [
      RETIREMENT_PEOPLE_CONVERTER,
      BUDGET_AMOUNTS_CONVERTER,
      NET_PAY_SNAPSHOT_CONVERTER,
    ]);
    db.close();
  });

  it("a routing that still pays from its snapshot refuses the start, and the whole tag rolls back", () => {
    installBefore([...SALARY_PROFILES, ...REFUSED]);
    const before = state((t) => reads(t, settingsBeforeTag), asReadBeforeTag);
    expect(() => runSQLite()).toThrow(MigrationRefusal);
    expect(() => runSQLite()).toThrow(
      /salary_profiles 107, 108, 109; jobs 21, 22, 31/,
    );
    const db = open();
    const recorded = db
      .prepare("SELECT count(*) AS n FROM __drizzle_migrations")
      .get() as { n: number };
    db.close();
    const shipped = JSON.parse(fs.readFileSync(journalPath(), "utf8")) as {
      entries: unknown[];
    };
    expect(recorded.n).toBe(shipped.entries.length - 1);
    const after = state((t) => reads(t, settingsBeforeTag), asReadBeforeTag);
    expect(after).toEqual(before);
  });
});
