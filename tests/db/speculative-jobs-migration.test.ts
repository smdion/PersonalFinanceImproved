/**
 * `0013_speculative_jobs`, applied after every prior migration.
 *
 * Adds `jobs.is_speculative` and backfills exactly one speculative job for
 * every EXISTING person — the permanent, auto-provisioned peg Salary
 * Profiles pin what-if scenarios against (see
 * src/lib/pure/profiles.ts's findActiveJob/filterActiveJobs for why this
 * must never be picked up as a person's real, active job).
 *
 * Verifies:
 *  1. A person with a real job gets exactly one speculative job added,
 *     alongside their real one untouched.
 *  2. A person with NO jobs at all also gets one (the backfill isn't
 *     gated on already having employment history).
 *  3. Idempotency: re-applying the migration does not create a second
 *     speculative job for anyone who already has one.
 *  4. The partial unique index actually rejects a second speculative job
 *     inserted by hand for the same person.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const MIGRATION_TAG = "0013_speculative_jobs";
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
    // Everything strictly before 0013.
    for (const entry of journal.entries) {
      if (entry.tag === MIGRATION_TAG) break;
      applyMigrationFile(db, entry.tag);
    }
    db.pragma("foreign_keys = OFF");

    // Person 101: has a real active job already.
    db.exec(`
      INSERT INTO people (id, name, date_of_birth, is_primary_user)
      VALUES (101, 'Alex', '1985-01-01', 1),
             (102, 'NoJobs', '1990-01-01', 0);

      INSERT INTO jobs
        (id, person_id, employer_name, annual_salary, pay_period, pay_week,
         start_date, w4_filing_status)
        VALUES (201, 101, 'BigCo', '150000', 'biweekly', 'na', '2020-01-01', 'MFJ');
    `);

    applyMigrationFile(db, MIGRATION_TAG);
  });

  afterAll(() => db.close());

  const jobsFor = (personId: number) =>
    db
      .prepare("SELECT * FROM jobs WHERE person_id = ? ORDER BY id")
      .all(personId) as Row[];

  it("gives a person with a real job exactly one speculative job, real job untouched", () => {
    const jobs = jobsFor(101);
    expect(jobs).toHaveLength(2);
    const real = jobs.find((j) => j.id === 201)!;
    expect(real.employer_name).toBe("BigCo");
    expect(real.is_speculative).toBe(0);
    const speculative = jobs.find((j) => j.id !== 201)!;
    expect(speculative.is_speculative).toBe(1);
    expect(speculative.employer_name).toBe("Speculative (What-If Planning)");
    expect(speculative.end_date).toBeNull();
  });

  it("gives a person with NO jobs at all one speculative job", () => {
    const jobs = jobsFor(102);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.is_speculative).toBe(1);
  });

  it("is idempotent — re-applying the migration does not create a second speculative job", () => {
    // The ALTER TABLE ADD COLUMN would fail on a real re-run (Drizzle's
    // migration ledger prevents that from happening for real), so re-apply
    // just the backfill INSERT to prove ITS idempotency specifically.
    const sql = fs
      .readFileSync(path.join(MIGRATIONS_DIR, `${MIGRATION_TAG}.sql`), "utf-8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("INSERT"))[0]!;
    db.exec(sql);
    db.exec(sql);
    expect(jobsFor(101)).toHaveLength(2);
    expect(jobsFor(102)).toHaveLength(1);
  });

  it("the partial unique index rejects a second speculative job for the same person", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO jobs
            (person_id, employer_name, annual_salary, pay_period, pay_week,
             start_date, w4_filing_status, is_speculative)
           VALUES (101, 'Speculative (What-If Planning)', '0', 'biweekly', 'na',
                   '2026-01-01', 'Single', 1)`,
        )
        .run(),
    ).toThrow();
  });
});
