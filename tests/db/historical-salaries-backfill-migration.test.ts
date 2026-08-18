/**
 * `backfillHistoricalSalariesSQLite` (db-migrate.ts) + `0015_historical_salaries`
 * + `0016_drop_salary_ledger_tables`, applied after every prior migration.
 *
 * Unlike 0010-0014's tests, the interesting logic here isn't in migration
 * SQL — it's in the JS backfill function that db-migrate.ts's idempotent
 * apply loop calls immediately before 0016 drops `salary_changes` and
 * `job_bonus_overrides` for good. This freezes that ledger into
 * `historical_salaries` (past years only) and rewrites every Salary
 * Profile's `salaries` to the job-keyed, complete-entries-only shape.
 *
 * Verifies:
 *  1. Multi-year no-raise gap: a person whose salary changed in 2019 and
 *     next changed in 2022 gets carried-forward rows for 2020 and 2021 too,
 *     not just the two years with an actual salary_changes row.
 *  2. Bonus-only year: a job_bonus_overrides row for a year with no salary
 *     change (2021, in the same fixture) still produces a bonus on that
 *     year's historical_salaries row instead of being dropped.
 *  3. Same-year job-change tie-break: when two of a person's jobs each
 *     have a salary_changes row landing in the same calendar year, the
 *     chronologically LATER change wins — verified with the later change
 *     on the LOWER job_id, so a job_id-based tie-break (the bug this
 *     replaces) would get it backwards.
 *  4. Salary Profile entries stay complete (all 4 fields) for an active
 *     job with an explicit pin.
 *  5. Salary Profile entries pinning only bonus terms (no `salary`) on an
 *     active job that also has no live salary_changes row are OMITTED
 *     entirely (never written as `salary: 0`).
 *  6. `salary_changes` / `job_bonus_overrides` are gone after 0016 applies.
 *  7. Idempotency: replaying the backfill + 0015 + 0016 sequence a second
 *     time (the shape of a squash-recovery replay) does not error and does
 *     not change any already-written historical_salaries row.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { backfillHistoricalSalariesSQLite } from "../../db-migrate";

const MIGRATIONS_DIR = path.resolve("./drizzle-sqlite");
const TAG_0015 = "0015_historical_salaries";
const TAG_0016 = "0016_drop_salary_ledger_tables";

type Row = Record<string, unknown>;

/** Strict apply — throws on any error. Used only for the clean pre-0015 setup. */
function applyMigrationFile(db: InstanceType<typeof Database>, tag: string) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf-8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) db.exec(trimmed);
  }
}

/**
 * Tolerant apply, mirroring db-migrate.ts's real per-statement try/catch in
 * runSQLite's idempotent pre-apply loop (the actual call site immediately
 * after backfillHistoricalSalariesSQLite runs) — both a first-time apply
 * and a replay go through this same tolerance in production, so this is
 * the faithful way to simulate either here.
 */
function applyMigrationFileIdempotent(
  db: InstanceType<typeof Database>,
  tag: string,
) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf-8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    try {
      db.exec(trimmed);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (
        msg.includes("already exists") ||
        msg.includes("duplicate column") ||
        msg.includes("no such column") ||
        msg.includes("no such table") ||
        msg.includes("no such index")
      ) {
        // idempotent — skip
      } else {
        throw err;
      }
    }
  }
}

describe("historical_salaries backfill (0015/0016)", () => {
  let db: InstanceType<typeof Database>;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");

    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf-8"),
    ) as { entries: { tag: string }[] };
    // Everything strictly before 0015 (so jobs.is_speculative from 0013
    // exists, and salary_changes/job_bonus_overrides are in their final
    // pre-freeze shape from 0014).
    for (const entry of journal.entries) {
      if (entry.tag === TAG_0015) break;
      applyMigrationFile(db, entry.tag);
    }
    db.pragma("foreign_keys = OFF");

    db.exec(`
      INSERT INTO people (id, name, date_of_birth, is_primary_user)
      VALUES (201, 'Casey', '1985-01-01', 1),
             (202, 'Jordan', '1988-01-01', 0),
             (203, 'Morgan', '1990-01-01', 0),
             (211, 'Riley', '1992-01-01', 0);

      -- Casey: job 301 ended, salary changes in 2019 and 2022 with a gap
      -- (2020, 2021) that should carry forward the 2019 salary, plus a
      -- bonus-only override in 2021 (no salary change that year).
      INSERT INTO jobs
        (id, person_id, employer_name, pay_period, pay_week,
         start_date, end_date, w4_filing_status)
        VALUES (301, 201, 'Casey Co', 'biweekly', 'na', '2018-01-01', '2022-12-31', 'Single');
      INSERT INTO salary_changes (job_id, effective_date, new_salary) VALUES
        (301, '2019-03-01', '100000'),
        (301, '2022-06-01', '120000');
      INSERT INTO job_bonus_overrides (job_id, year, override_amount) VALUES
        (301, 2021, '5000');

      -- Morgan: two jobs, both ended in 2020, each with exactly one salary
      -- change landing in 2020 — job 500 (lower id) changes LATER in the
      -- year than job 600 (higher id), so a job_id-based tie-break would
      -- pick job 600's 80000 while the correct chronological tie-break
      -- picks job 500's 95000.
      INSERT INTO jobs
        (id, person_id, employer_name, pay_period, pay_week,
         start_date, end_date, w4_filing_status)
        VALUES (500, 203, 'Later Change Co', 'biweekly', 'na', '2019-01-01', '2020-12-31', 'Single');
      INSERT INTO jobs
        (id, person_id, employer_name, pay_period, pay_week,
         start_date, end_date, w4_filing_status)
        VALUES (600, 203, 'Earlier Change Co', 'biweekly', 'na', '2019-06-01', '2020-12-31', 'Single');
      INSERT INTO salary_changes (job_id, effective_date, new_salary) VALUES
        (500, '2020-11-01', '95000'),
        (600, '2020-02-01', '80000');

      -- Riley: one active job with a real salary_changes row and an
      -- explicit, complete-looking Salary Profile pin.
      INSERT INTO jobs
        (id, person_id, employer_name, pay_period, pay_week,
         start_date, w4_filing_status)
        VALUES (311, 211, 'Riley Co', 'biweekly', 'na', '2020-01-01', 'Single');
      INSERT INTO salary_changes (job_id, effective_date, new_salary) VALUES
        (311, '2020-01-01', '150000');

      -- Jordan: one active job with ZERO salary_changes rows, pinned by a
      -- Salary Profile that carries only bonus terms (no salary field) —
      -- there is no real number to write for this job.
      INSERT INTO jobs
        (id, person_id, employer_name, pay_period, pay_week,
         start_date, w4_filing_status)
        VALUES (302, 202, 'Jordan Co', 'biweekly', 'na', '2021-01-01', 'Single');

      INSERT INTO salary_profiles (id, name, description, salaries) VALUES
        (701, 'Riley Pin', 'complete pin',
             '{"311":{"salary":160000,"bonusPercent":0.1,"bonusMultiplier":1,"monthsInBonusYear":12}}'),
        (702, 'Jordan Pin', 'bonus-only, no live salary',
             '{"302":{"bonusPercent":0.2}}');
    `);

    // --- First pass: backfill, then apply 0015 and 0016 the same way the
    // real idempotent apply loop does (tolerant of "already exists" from
    // backfill's own CREATE TABLE IF NOT EXISTS). ---
    backfillHistoricalSalariesSQLite(db);
    applyMigrationFileIdempotent(db, TAG_0015);
    applyMigrationFileIdempotent(db, TAG_0016);
  });

  afterAll(() => db.close());

  const histRows = (personId: number) =>
    (
      db
        .prepare(
          "SELECT year, salary, bonus FROM historical_salaries WHERE person_id = ? ORDER BY year",
        )
        .all(personId) as Row[]
    ).map((r) => ({ year: r.year, salary: r.salary, bonus: r.bonus }));

  const salariesOf = (profileId: number) =>
    JSON.parse(
      (
        db
          .prepare("SELECT salaries FROM salary_profiles WHERE id = ?")
          .get(profileId) as Row
      ).salaries as string,
    );

  it("carries a salary forward through years with no raise", () => {
    expect(histRows(201)).toEqual([
      { year: 2019, salary: "100000", bonus: "0.00" },
      { year: 2020, salary: "100000", bonus: "0.00" },
      { year: 2021, salary: "100000", bonus: "5000" },
      { year: 2022, salary: "120000", bonus: "0.00" },
    ]);
  });

  it("attaches a bonus-only year's override even with no salary change that year", () => {
    const row2021 = histRows(201).find((r) => r.year === 2021);
    expect(row2021?.bonus).toBe("5000");
  });

  it("picks the chronologically LATEST same-year change, not the highest job_id", () => {
    expect(histRows(203)).toEqual([
      { year: 2020, salary: "95000", bonus: "0.00" },
    ]);
  });

  it("keeps a Salary Profile entry complete for an active job with an explicit pin", () => {
    expect(salariesOf(701)).toEqual({
      "311": {
        salary: 160000,
        bonusPercent: 0.1,
        bonusMultiplier: 1,
        monthsInBonusYear: 12,
      },
    });
  });

  it("omits a bonus-only pin with no live salary rather than writing salary: 0", () => {
    expect(salariesOf(702)).toEqual({});
  });

  it("drops salary_changes and job_bonus_overrides after 0016", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('salary_changes','job_bonus_overrides')",
      )
      .all();
    expect(tables).toEqual([]);
  });

  describe("idempotency: replaying backfill + 0015 + 0016", () => {
    let beforeReplay: Record<number, ReturnType<typeof histRows>>;

    beforeAll(() => {
      beforeReplay = {
        201: histRows(201),
        203: histRows(203),
      };
      expect(() => {
        // salary_changes no longer exists — backfill must no-op cleanly.
        backfillHistoricalSalariesSQLite(db);
        applyMigrationFileIdempotent(db, TAG_0015);
        applyMigrationFileIdempotent(db, TAG_0016);
      }).not.toThrow();
    });

    it("does not error on replay", () => {
      // Assertion is the beforeAll not throwing; this test exists so a
      // failure surfaces under a readable name.
      expect(true).toBe(true);
    });

    it("does not change any already-written historical_salaries row", () => {
      expect(histRows(201)).toEqual(beforeReplay[201]);
      expect(histRows(203)).toEqual(beforeReplay[203]);
    });
  });
});
