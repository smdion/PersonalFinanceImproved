/**
 * `0012_salary_profile_job_keyed`, applied after every prior migration.
 *
 * Rekeys `salary_profiles.salaries` from personId-keyed entries to
 * jobId-keyed entries — a Salary Profile pins a SPECIFIC job's terms, not
 * "whichever job this person currently has". Verifies:
 *  1. A pin for a person with one active job lands under that job's id,
 *     value intact.
 *  2. A pin for a person with NO active job (all jobs ended) is dropped —
 *     nothing to target under the new key.
 *  3. Every person's pin in a multi-person profile is rekeyed independently.
 *  4. A profile with no salaries at all is left as an empty object.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const MIGRATION_TAG = "0012_salary_profile_job_keyed";
const MIGRATIONS_DIR = path.resolve("./drizzle-sqlite");

type Row = Record<string, unknown>;

function applyMigrationFile(db: InstanceType<typeof Database>, tag: string) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf-8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) db.exec(trimmed);
  }
}

describe(MIGRATION_TAG, () => {
  let db: InstanceType<typeof Database>;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");

    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf-8"),
    ) as { entries: { tag: string }[] };
    // Everything strictly before 0012.
    for (const entry of journal.entries) {
      if (entry.tag === MIGRATION_TAG) break;
      applyMigrationFile(db, entry.tag);
    }
    // A prior migration's ALTER TABLE rebuild resets this — re-disable
    // before seeding cross-referencing test rows (same fix
    // contribution-accounts-no-base-value-migration.test.ts needed).
    db.pragma("foreign_keys = OFF");

    // ---- People + jobs ----
    db.exec(`
      INSERT INTO people (id, name, date_of_birth, is_primary_user)
      VALUES (101, 'Alex', '1985-01-01', 1),
             (102, 'Sam', '1987-01-01', 0),
             (103, 'Jamie', '1990-01-01', 0);

      -- Alex: one active job (id 201).
      INSERT INTO jobs
        (id, person_id, employer_name, annual_salary, pay_period, pay_week,
         start_date, w4_filing_status)
        VALUES (201, 101, 'BigCo', '150000', 'biweekly', 'na', '2020-01-01', 'MFJ');

      -- Sam: one ENDED job (id 202) and one active job (id 203) — the pin
      -- should follow the active one, not the stale ended one.
      INSERT INTO jobs
        (id, person_id, employer_name, annual_salary, pay_period, pay_week,
         start_date, end_date, w4_filing_status)
        VALUES (202, 102, 'OldCo', '90000', 'biweekly', 'na', '2018-01-01', '2023-12-31', 'Single');
      INSERT INTO jobs
        (id, person_id, employer_name, annual_salary, pay_period, pay_week,
         start_date, w4_filing_status)
        VALUES (203, 102, 'NewCo', '110000', 'biweekly', 'na', '2024-01-01', 'Single');

      -- Jamie: NO active job (their only job has ended) — their pin has
      -- nothing to target and must be dropped.
      INSERT INTO jobs
        (id, person_id, employer_name, annual_salary, pay_period, pay_week,
         start_date, end_date, w4_filing_status)
        VALUES (204, 103, 'GoneCo', '80000', 'biweekly', 'na', '2015-01-01', '2021-12-31', 'Single');

      INSERT INTO salary_profiles (id, name, description, salaries) VALUES
        (301, 'Single Pin', 'Alex only',
             '{"101":{"salary":160000}}'),
        (302, 'Ended Job Person', 'Sam pinned to their ended job key',
             '{"102":{"salary":120000,"bonusPercent":0.1}}'),
        (303, 'No Active Job', 'Jamie has nothing to target',
             '{"103":{"salary":85000}}'),
        (304, 'Multi Person', 'Alex + Sam both pinned',
             '{"101":{"salary":165000},"102":{"bonusMultiplier":1.5}}'),
        (305, 'Empty', 'nothing pinned', '{}');
    `);

    applyMigrationFile(db, MIGRATION_TAG);
  });

  afterAll(() => db.close());

  const salaries = (id: number) =>
    JSON.parse(
      (
        db
          .prepare("SELECT salaries FROM salary_profiles WHERE id = ?")
          .get(id) as Row
      ).salaries as string,
    );

  it("rekeys a person's pin under their active job's id", () => {
    expect(salaries(301)).toEqual({ "201": { salary: 160000 } });
  });

  it("follows the ACTIVE job, not an ended one — value and fields intact", () => {
    expect(salaries(302)).toEqual({
      "203": { salary: 120000, bonusPercent: 0.1 },
    });
  });

  it("drops a pin for a person with no active job", () => {
    expect(salaries(303)).toEqual({});
  });

  it("rekeys every person in a multi-person profile independently", () => {
    expect(salaries(304)).toEqual({
      "201": { salary: 165000 },
      "203": { bonusMultiplier: 1.5 },
    });
  });

  it("leaves an already-empty profile as an empty object", () => {
    expect(salaries(305)).toEqual({});
  });
});
