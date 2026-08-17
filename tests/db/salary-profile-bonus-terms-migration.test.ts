/**
 * `0009_salary_profile_bonus_terms`, applied ON TOP OF 0008.
 *
 * 0008 reshaped `salary_profiles.salaries` from a sparse
 * `Record<personId, number>` into a complete
 * `Record<personId, {mode:"job"} | {mode:"fixed", salary}>`. 0009 un-reshapes
 * the same column into the presence encoding
 * (`{}` / `{salary: N}` / `{bonusPercent: ...}`). Because the two touch the
 * same data in sequence, the thing worth proving is COMPOSITION: a database
 * that has only ever seen the pre-0008 shape must arrive at the right place
 * after running both, with every pin intact.
 *
 * So this seeds pre-0008 data, runs 0008, then runs 0009 — the exact sequence
 * a production database will follow — rather than testing 0009 against
 * hand-written intermediate state that might not be what 0008 actually
 * produces.
 *
 * It also covers the two things 0009 must not get wrong on its own:
 *  1. A pinned salary SURVIVES as `{salary: N}`. Losing it would silently
 *     un-pin someone's what-if profile.
 *  2. Bonus AMOUNT terms are stripped from contribution_overrides while
 *     every other override key — including the bonus-handling flags and the
 *     bonus pay date — is left alone.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const MIGRATION_TAG = "0009_salary_profile_bonus_terms";
const MIGRATIONS_DIR = path.resolve("./drizzle-sqlite");

type Row = Record<string, unknown>;

function applyMigrationFile(db: InstanceType<typeof Database>, tag: string) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf-8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) db.exec(trimmed);
  }
}

describe(`${MIGRATION_TAG} composed after 0008`, () => {
  let db: InstanceType<typeof Database>;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");

    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf-8"),
    ) as { entries: { tag: string }[] };
    // Everything strictly before 0008.
    for (const entry of journal.entries) {
      if (entry.tag.startsWith("0008_")) break;
      applyMigrationFile(db, entry.tag);
    }

    // ---- Pre-0008 data, in the oldest shape ----
    db.exec(`
      INSERT INTO people (id, name, date_of_birth, is_primary_user)
      VALUES (1, 'Alex', '1985-01-01', 1), (2, 'Sam', '1987-01-01', 0);

      INSERT INTO salary_profiles (id, name, description, salary_overrides) VALUES
        (10, 'Promotion',  'one person pinned', '{"1":150000}'),
        (11, 'Both Raised','both pinned',       '{"1":150000,"2":90000}'),
        (12, 'No Pins',    'nothing pinned',    '{}');

      INSERT INTO contribution_profiles
        (id, name, description, contribution_overrides, is_default) VALUES
        (20, 'Live', 'the former default', '{}', 1),
        (21, 'Mixed Overrides', 'job + account overrides',
             '{"contributionAccounts":{"5":{"contributionValue":"0.2"}},' ||
             '"jobs":{"7":{"bonusPercent":"0.25","bonusMultiplier":"2",' ||
             '"monthsInBonusYear":6,"employerName":"NewCorp",' ||
             '"include401kInBonus":true,"includeBonusInContributions":false,' ||
             '"bonusMonth":3}}}', 0);

      INSERT INTO app_settings (key, value)
      VALUES ('active_salary_profile_id', 'null'),
             ('budget_active_column', '0');
    `);

    applyMigrationFile(db, "0008_kill_live_sentinel");
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
  const overrides = (id: number) =>
    JSON.parse(
      (
        db
          .prepare(
            "SELECT contribution_overrides FROM contribution_profiles WHERE id = ?",
          )
          .get(id) as Row
      ).contribution_overrides as string,
    );

  describe("salary_profiles.salaries re-encoding", () => {
    it("keeps a pinned salary, as {salary: N}", () => {
      // 0008 made this {"1":{mode:"fixed",salary:150000},"2":{mode:"job"}}.
      expect(salaries(10)).toEqual({ "1": { salary: 150000 }, "2": {} });
    });

    it("keeps every pin when more than one person is pinned", () => {
      expect(salaries(11)).toEqual({
        "1": { salary: 150000 },
        "2": { salary: 90000 },
      });
    });

    it("turns an all-unpinned profile into all-empty entries", () => {
      // 0008 expanded the empty map to a mode:"job" entry per person; 0009
      // reduces those to entries that pin nothing. Same meaning throughout.
      expect(salaries(12)).toEqual({ "1": {}, "2": {} });
    });

    it("leaves no `mode` key anywhere", () => {
      const all = db
        .prepare("SELECT salaries FROM salary_profiles")
        .all() as Row[];
      for (const row of all) {
        expect(row.salaries as string).not.toContain('"mode"');
      }
    });

    it("the profile 0008 seeds also lands in the new shape", () => {
      const seeded = db
        .prepare("SELECT id, salaries FROM salary_profiles WHERE id > 12")
        .all() as Row[];
      expect(seeded).toHaveLength(1);
      expect(JSON.parse(seeded[0]!.salaries as string)).toEqual({
        "1": {},
        "2": {},
      });
    });

    it("is idempotent — a second run does not blank the pins", () => {
      // The dangerous failure mode: a re-run sees no mode:"fixed" and
      // rewrites every entry to {}. Guarded explicitly in the SQL.
      applyMigrationFile(db, MIGRATION_TAG);
      expect(salaries(10)).toEqual({ "1": { salary: 150000 }, "2": {} });
      expect(salaries(11)).toEqual({
        "1": { salary: 150000 },
        "2": { salary: 90000 },
      });
    });
  });

  describe("contribution_overrides bonus-term strip", () => {
    it("removes the three bonus AMOUNT terms", () => {
      const job = overrides(21).jobs["7"];
      expect(job).not.toHaveProperty("bonusPercent");
      expect(job).not.toHaveProperty("bonusMultiplier");
      expect(job).not.toHaveProperty("monthsInBonusYear");
    });

    it("keeps everything the Contribution Profile still owns", () => {
      // These are about how contributions are computed FROM a bonus, or when
      // it is paid — not about how big it is.
      expect(overrides(21).jobs["7"]).toEqual({
        employerName: "NewCorp",
        include401kInBonus: true,
        includeBonusInContributions: false,
        bonusMonth: 3,
      });
    });

    it("leaves contributionAccounts untouched", () => {
      expect(overrides(21).contributionAccounts).toEqual({
        "5": { contributionValue: "0.2" },
      });
    });

    it("leaves a profile with no job overrides alone", () => {
      expect(overrides(20)).toEqual({});
    });
  });
});
