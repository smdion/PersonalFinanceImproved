/**
 * `0014_salary_no_base_value`, applied after every prior migration
 * (including 0013).
 *
 * Drops `jobs.annual_salary`/`bonus_percent`/`bonus_multiplier`/
 * `months_in_bonus_year` — a job is purely structural from here on.
 * `salary_changes` becomes the ONLY salary source; bonus terms only ever
 * resolve from a Salary Profile pin. Before dropping the columns, the
 * migration:
 *   1. backfills a salary_changes row at-or-before start_date for any job
 *      missing one,
 *   2. backfills every Salary Profile's bonus terms from every job's
 *      current values, gaps-only per field,
 *   3. backfills job_bonus_overrides for every (job, year) a bonus-earning
 *      job existed, computed from that year's resolved salary + the job's
 *      current bonus formula terms.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const MIGRATION_TAG = "0014_salary_no_base_value";
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
    for (const entry of journal.entries) {
      if (entry.tag === MIGRATION_TAG) break;
      applyMigrationFile(db, entry.tag);
    }
    db.pragma("foreign_keys = OFF");

    // ---- Pre-migration data, under the old live-value columns ----
    // Person 1's jobs:
    //   Job 101 — no bonus, ended, has a salary_changes row already at
    //     start_date. Migration should leave its salary_changes untouched
    //     and skip job_bonus_overrides entirely (bonus_percent = 0).
    //   Job 102 — current job, 10% bonus, has ONLY a post-start raise row
    //     (no row at start_date) — the exact real-data gap this migration
    //     exists to close for both salary_changes and job_bonus_overrides.
    // Person 2's job:
    //   Job 103 — current job, zero salary_changes rows at all.
    //   Job 104 — the auto-provisioned speculative peg. Must be excluded
    //     from the bonus-term backfill entirely: a neutral pin there would
    //     make salaryProfile.getById's job-selection logic treat it as
    //     "pinned" and outrank the real job 103 (see salary-profiles.ts).
    db.exec(`
      INSERT INTO people (id, name, date_of_birth, is_primary_user) VALUES
        (1, 'Sean', '1990-01-01', 1),
        (2, 'Joanna', '1991-01-01', 0);

      INSERT INTO jobs
        (id, person_id, employer_name, annual_salary, pay_period, pay_week,
         start_date, end_date, bonus_percent, bonus_multiplier, months_in_bonus_year,
         w4_filing_status, is_speculative) VALUES
        (101, 1, 'OldCo', '50000.00', 'biweekly', 'na', '2018-01-01', '2020-01-01', '0', '1.0', 12, 'Single', 0),
        (102, 1, 'NewCo', '100000.00', 'biweekly', 'even', '2022-01-01', NULL, '0.10', '1.0', 12, 'Single', 0),
        (103, 2, 'OtherCo', '80000.00', 'biweekly', 'odd', '2021-06-01', NULL, '0', '1.0', 12, 'Single', 0),
        (104, 2, 'Speculative (What-If Planning)', '0.00', 'biweekly', 'na', '2026-01-01', NULL, '0', '1.0', 12, 'Single', 1);

      -- Job 101 already has its starting-salary row — untouched case.
      INSERT INTO salary_changes (job_id, effective_date, new_salary) VALUES
        (101, '2018-01-01', '50000.00');

      -- Job 102's earliest row is AFTER start_date — the "raises but no
      -- starting point" gap.
      INSERT INTO salary_changes (job_id, effective_date, new_salary) VALUES
        (102, '2023-01-01', '105000.00');

      -- Job 103: zero salary_changes rows at all.

      DELETE FROM salary_profiles;
      INSERT INTO salary_profiles (id, name, salaries) VALUES
        (201, 'Household', '{}'),
        (202, 'Custom', '{"102":{"bonusPercent":0.5}}');
    `);

    applyMigrationFile(db, MIGRATION_TAG);
  });

  afterAll(() => db.close());

  const salaryChangesFor = (jobId: number) =>
    db
      .prepare(
        "SELECT effective_date, new_salary, notes FROM salary_changes WHERE job_id = ? ORDER BY effective_date",
      )
      .all(jobId) as Row[];

  const salariesFor = (profileId: number) =>
    JSON.parse(
      (
        db
          .prepare("SELECT salaries FROM salary_profiles WHERE id = ?")
          .get(profileId) as Row
      ).salaries as string,
    );

  const bonusOverridesFor = (jobId: number) =>
    db
      .prepare(
        "SELECT year, override_amount FROM job_bonus_overrides WHERE job_id = ? ORDER BY year",
      )
      .all(jobId) as Row[];

  it("drops the base-value columns", () => {
    const cols = db.prepare("PRAGMA table_info(jobs)").all() as Row[];
    const names = cols.map((c) => c.name);
    expect(names).not.toContain("annual_salary");
    expect(names).not.toContain("bonus_percent");
    expect(names).not.toContain("bonus_multiplier");
    expect(names).not.toContain("months_in_bonus_year");
  });

  it("leaves a job that already has a starting-salary row untouched", () => {
    expect(salaryChangesFor(101)).toEqual([
      { effective_date: "2018-01-01", new_salary: "50000.00", notes: null },
    ]);
  });

  it("backfills a starting-salary row for a job whose earliest row is after start_date", () => {
    expect(salaryChangesFor(102)).toEqual([
      {
        effective_date: "2022-01-01",
        new_salary: "100000.00",
        notes: "Backfilled starting salary (Phase 2 migration)",
      },
      { effective_date: "2023-01-01", new_salary: "105000.00", notes: null },
    ]);
  });

  it("backfills a starting-salary row for a job with zero salary_changes rows", () => {
    expect(salaryChangesFor(103)).toEqual([
      {
        effective_date: "2021-06-01",
        new_salary: "80000.00",
        notes: "Backfilled starting salary (Phase 2 migration)",
      },
    ]);
  });

  it("backfills every job's bonus terms into a profile with no prior entry", () => {
    const salaries = salariesFor(201);
    expect(salaries["101"]).toEqual({
      bonusPercent: 0,
      bonusMultiplier: 1,
      monthsInBonusYear: 12,
    });
    expect(salaries["102"]).toEqual({
      bonusPercent: 0.1,
      bonusMultiplier: 1,
      monthsInBonusYear: 12,
    });
    expect(salaries["103"]).toEqual({
      bonusPercent: 0,
      bonusMultiplier: 1,
      monthsInBonusYear: 12,
    });
  });

  it("excludes the speculative job from the bonus-term backfill entirely", () => {
    expect(salariesFor(201)).not.toHaveProperty("104");
    expect(salariesFor(202)).not.toHaveProperty("104");
  });

  it("fills in only the missing fields for a profile that already pins bonusPercent, preserving the pin", () => {
    const salaries = salariesFor(202);
    expect(salaries["102"]).toEqual({
      bonusPercent: 0.5, // pre-existing pin — must survive untouched
      bonusMultiplier: 1,
      monthsInBonusYear: 12,
    });
  });

  it("skips job_bonus_overrides backfill for a job with no bonus percent", () => {
    expect(bonusOverridesFor(101)).toEqual([]);
    expect(bonusOverridesFor(103)).toEqual([]);
  });

  it("backfills job_bonus_overrides for every year a bonus-earning job existed, computed from that year's resolved salary", () => {
    // Job 102: 10% bonus, starts 2022 at 100000, raised to 105000 in 2023.
    // No end_date, so backfilled through the current year too.
    const overrides = bonusOverridesFor(102);
    const byYear = Object.fromEntries(
      overrides.map((o) => [o.year, Number(o.override_amount)]),
    );
    expect(byYear[2022]).toBeCloseTo(10000, 2); // 100000 * 0.10
    expect(byYear[2023]).toBeCloseTo(10500, 2); // 105000 * 0.10
  });
});
