/**
 * `0008_kill_live_sentinel` data-preserving backfill.
 *
 * Applies migrations 0000–0007 to a fresh SQLite DB, seeds realistic
 * pre-migration data, then applies 0008 and asserts on the result. The point
 * is the two things the migration must not get wrong:
 *
 *  1. The SHAPE CONVERSION — every existing profile's sparse
 *     `Record<personId, number>` becomes a complete
 *     `Record<personId, {mode:"job"} | {mode:"fixed", salary}>`: a person who
 *     had a number was explicitly pinned, everyone else follows their job.
 *
 *  2. The NULL DISTINCTION — `null` means "use Live" on the app_settings
 *     active-profile keys (backfilled to a real id) and "pins nothing" on
 *     every Plan / retirement / budget-column pin (left exactly as found).
 *     Collapsing the two would silently pin every existing Plan and budget
 *     column to the baseline profile.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const MIGRATION_TAG = "0008_kill_live_sentinel";
const MIGRATIONS_DIR = path.resolve("./drizzle-sqlite");

type Row = Record<string, unknown>;

function applyMigrationFile(db: InstanceType<typeof Database>, tag: string) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf-8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) db.exec(trimmed);
  }
}

describe(`${MIGRATION_TAG} backfill`, () => {
  let db: InstanceType<typeof Database>;

  beforeAll(() => {
    db = new Database(":memory:");
    // The pre-0008 seed below inserts pins pointing at rows it also creates;
    // FK order isn't the subject under test.
    db.pragma("foreign_keys = OFF");

    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf-8"),
    ) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      if (entry.tag === MIGRATION_TAG) break;
      applyMigrationFile(db, entry.tag);
    }

    // ---- Pre-migration data, in the old shapes ----
    db.exec(`
      INSERT INTO people (id, name, date_of_birth, is_primary_user)
      VALUES (1, 'Alex', '1985-01-01', 1), (2, 'Sam', '1987-01-01', 0);

      INSERT INTO salary_profiles (id, name, description, salary_overrides) VALUES
        (10, 'Promotion', 'one person pinned', '{"1":150000}'),
        (11, 'Both Raised', 'both pinned',     '{"1":150000,"2":90000}'),
        (12, 'No Pins',    'sparse + empty',   '{}');

      INSERT INTO contribution_profiles
        (id, name, description, contribution_overrides, is_default) VALUES
        (20, 'Live', 'the former default', '{}', 1),
        (21, 'Max Out', 'a what-if',
             '{"contributionAccounts":{"5":{"contributionValue":"0.2"}}}', 0);

      INSERT INTO budget_profiles
        (id, name, column_labels, column_contribution_profile_ids,
         column_salary_profile_ids, is_active)
      VALUES (30, 'Main', '["A","B"]', '[null,21]', '[null,10]', 1);

      INSERT INTO scenarios (id, name, contribution_profile_id, salary_profile_id)
      VALUES (40, 'Pins Nothing', NULL, NULL),
             (41, 'Pins Both', 21, 10);

      INSERT INTO retirement_salary_overrides
        (id, person_id, projection_year, override_salary,
         contribution_profile_id, salary_profile_id)
      VALUES (50, 1, 2031, '0', NULL, NULL),
             (51, 2, 2031, '0', 21, 10);

      -- 'null' is the JSON encoding of the old "use Live" sentinel.
      -- active_contrib_profile_id is deliberately ABSENT entirely.
      INSERT INTO app_settings (key, value)
      VALUES ('active_salary_profile_id', 'null'),
             ('budget_active_column', '0');
    `);

    applyMigrationFile(db, MIGRATION_TAG);
  });

  afterAll(() => db.close());

  const salaryProfiles = () =>
    db.prepare("SELECT * FROM salary_profiles ORDER BY id").all() as Row[];
  const setting = (key: string) =>
    (
      db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
        { value: string } | undefined
    )?.value;

  describe("shape conversion", () => {
    it("turns a pinned person into mode:'fixed' and everyone else into mode:'job'", () => {
      const p = salaryProfiles().find((r) => r.id === 10)!;
      expect(JSON.parse(p.salaries as string)).toEqual({
        "1": { mode: "fixed", salary: 150000 },
        "2": { mode: "job" },
      });
    });

    it("keeps every pinned value when the whole household was pinned", () => {
      const p = salaryProfiles().find((r) => r.id === 11)!;
      expect(JSON.parse(p.salaries as string)).toEqual({
        "1": { mode: "fixed", salary: 150000 },
        "2": { mode: "fixed", salary: 90000 },
      });
    });

    it("expands an empty map into a complete all-job map", () => {
      // "Complete in entries, not in values" — the whole point of the
      // discriminator. Nobody is pinned, but everybody has an entry.
      const p = salaryProfiles().find((r) => r.id === 12)!;
      expect(JSON.parse(p.salaries as string)).toEqual({
        "1": { mode: "job" },
        "2": { mode: "job" },
      });
    });

    it("drops the old column entirely", () => {
      const cols = (
        db.prepare("PRAGMA table_info(salary_profiles)").all() as Row[]
      ).map((c) => c.name);
      expect(cols).toContain("salaries");
      expect(cols).not.toContain("salary_overrides");
    });
  });

  describe("seeded baseline", () => {
    it("adds exactly one new, ordinary Salary Profile with every person on job mode", () => {
      const all = salaryProfiles();
      expect(all).toHaveLength(4);
      const seeded = all.find((r) => r.name === "Current")!;
      expect(seeded).toBeDefined();
      expect(seeded.id).toBeGreaterThan(12);
      expect(JSON.parse(seeded.salaries as string)).toEqual({
        "1": { mode: "job" },
        "2": { mode: "job" },
      });
    });

    it("does NOT insert a Contribution Profile — the former default row is reused", () => {
      const rows = db
        .prepare("SELECT id, name FROM contribution_profiles ORDER BY id")
        .all() as Row[];
      expect(rows).toEqual([
        { id: 20, name: "Live" },
        { id: 21, name: "Max Out" },
      ]);
    });

    it("keeps the former default row's contents and drops only the flag", () => {
      const cols = (
        db.prepare("PRAGMA table_info(contribution_profiles)").all() as Row[]
      ).map((c) => c.name);
      expect(cols).not.toContain("is_default");
      const row = db
        .prepare("SELECT * FROM contribution_profiles WHERE id = 20")
        .get() as Row;
      expect(row.contribution_overrides).toBe("{}");
    });
  });

  describe("'null means use Live' — app_settings, backfilled to a real id", () => {
    it("replaces the salary sentinel with the seeded row's id", () => {
      const seeded = salaryProfiles().find((r) => r.name === "Current")!;
      expect(setting("active_salary_profile_id")).toBe(String(seeded.id));
    });

    it("inserts the contribution key (absent before) pointing at the former default", () => {
      expect(setting("active_contrib_profile_id")).toBe("20");
    });

    it("leaves unrelated settings alone", () => {
      expect(setting("budget_active_column")).toBe("0");
    });
  });

  describe("'null means no pin' — left exactly as found", () => {
    it("does not touch scenarios pins", () => {
      const rows = db
        .prepare(
          "SELECT id, contribution_profile_id, salary_profile_id FROM scenarios ORDER BY id",
        )
        .all() as Row[];
      expect(rows).toEqual([
        { id: 40, contribution_profile_id: null, salary_profile_id: null },
        { id: 41, contribution_profile_id: 21, salary_profile_id: 10 },
      ]);
    });

    it("does not touch retirement_salary_overrides pins", () => {
      const rows = db
        .prepare(
          "SELECT id, contribution_profile_id, salary_profile_id FROM retirement_salary_overrides ORDER BY id",
        )
        .all() as Row[];
      expect(rows).toEqual([
        { id: 50, contribution_profile_id: null, salary_profile_id: null },
        { id: 51, contribution_profile_id: 21, salary_profile_id: 10 },
      ]);
    });

    it("does not touch per-budget-column pin arrays, nulls included", () => {
      const row = db
        .prepare(
          "SELECT column_contribution_profile_ids AS c, column_salary_profile_ids AS s FROM budget_profiles WHERE id = 30",
        )
        .get() as Row;
      expect(JSON.parse(row.c as string)).toEqual([null, 21]);
      expect(JSON.parse(row.s as string)).toEqual([null, 10]);
    });
  });

  describe("name collision", () => {
    it("falls back to the next free candidate when 'Current' is taken", () => {
      const fresh = new Database(":memory:");
      fresh.pragma("foreign_keys = OFF");
      const journal = JSON.parse(
        fs.readFileSync(
          path.join(MIGRATIONS_DIR, "meta/_journal.json"),
          "utf-8",
        ),
      ) as { entries: { tag: string }[] };
      for (const entry of journal.entries) {
        if (entry.tag === MIGRATION_TAG) break;
        applyMigrationFile(fresh, entry.tag);
      }
      fresh.exec(
        `INSERT INTO salary_profiles (id, name, salary_overrides) VALUES (1, 'Current', '{}');`,
      );
      applyMigrationFile(fresh, MIGRATION_TAG);
      const names = (
        fresh
          .prepare("SELECT name FROM salary_profiles ORDER BY id")
          .all() as Row[]
      ).map((r) => r.name);
      expect(names).toEqual(["Current", "Current (2)"]);
      fresh.close();
    });
  });

  describe("fresh install (empty tables)", () => {
    it("seeds one profile of each kind and points both settings at them", () => {
      const fresh = new Database(":memory:");
      fresh.pragma("foreign_keys = OFF");
      const journal = JSON.parse(
        fs.readFileSync(
          path.join(MIGRATIONS_DIR, "meta/_journal.json"),
          "utf-8",
        ),
      ) as { entries: { tag: string }[] };
      for (const entry of journal.entries) {
        if (entry.tag === MIGRATION_TAG) break;
        applyMigrationFile(fresh, entry.tag);
      }
      applyMigrationFile(fresh, MIGRATION_TAG);

      const sal = fresh
        .prepare("SELECT id, name, salaries FROM salary_profiles")
        .all() as Row[];
      expect(sal).toHaveLength(1);
      // No people yet — a complete map over zero people is an empty map.
      expect(JSON.parse(sal[0]!.salaries as string)).toEqual({});

      const contrib = fresh
        .prepare("SELECT id, name FROM contribution_profiles")
        .all() as Row[];
      expect(contrib).toHaveLength(1);

      const settings = Object.fromEntries(
        (
          fresh.prepare("SELECT key, value FROM app_settings").all() as Row[]
        ).map((r) => [r.key, r.value]),
      );
      expect(settings.active_salary_profile_id).toBe(String(sal[0]!.id));
      expect(settings.active_contrib_profile_id).toBe(String(contrib[0]!.id));
      fresh.close();
    });
  });
});
