/**
 * `0010_contribution_active_fields`, applied after every prior migration.
 *
 * R19 Phase 1: renames `contribution_profiles.contribution_overrides` to
 * `contribution_active_fields` (a pure column rename — no stored bytes
 * change) and rewrites the nested `displayNameOverride` JSON key to
 * `displayNameActive` inside every profile's `contributionAccounts` map
 * (this DOES touch stored bytes, so it's the part worth proving: every
 * other key — `isActive`, `contributionMethod`, `contributionValue`, the
 * `jobs` map — must survive byte-for-byte, and the rename must not fire on
 * entries that never had the key).
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const MIGRATION_TAG = "0010_contribution_active_fields";
const MIGRATIONS_DIR = path.resolve("./drizzle-sqlite");

type Row = Record<string, unknown>;

function applyMigrationFile(db: InstanceType<typeof Database>, tag: string) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf-8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) db.exec(trimmed);
  }
}

describe(`${MIGRATION_TAG}`, () => {
  let db: InstanceType<typeof Database>;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");

    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf-8"),
    ) as { entries: { tag: string }[] };
    // Everything strictly before 0010.
    for (const entry of journal.entries) {
      if (entry.tag === MIGRATION_TAG) break;
      applyMigrationFile(db, entry.tag);
    }

    // ---- Pre-0010 data, under the old `contribution_overrides` column ----
    db.exec(`
      INSERT INTO contribution_profiles
        (id, name, contribution_overrides) VALUES
        (30, 'Named Override',
             '{"contributionAccounts":{"5":{"contributionValue":"0.2",' ||
             '"contributionMethod":"percent_of_salary","isActive":true,' ||
             '"displayNameOverride":"Sean 401k"}},"jobs":{}}'),
        (31, 'No Name Override',
             '{"contributionAccounts":{"6":{"contributionValue":"625",' ||
             '"isActive":false}},"jobs":{"9":{"employerName":"NewCorp"}}}'),
        (32, 'Empty', '{}');
    `);

    applyMigrationFile(db, MIGRATION_TAG);
  });

  afterAll(() => db.close());

  const activeFields = (id: number) =>
    JSON.parse(
      (
        db
          .prepare(
            "SELECT contribution_active_fields FROM contribution_profiles WHERE id = ?",
          )
          .get(id) as Row
      ).contribution_active_fields as string,
    );

  it("renames the column — old name is gone, new name has the data", () => {
    const cols = db
      .prepare("PRAGMA table_info(contribution_profiles)")
      .all() as Row[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("contribution_active_fields");
    expect(names).not.toContain("contribution_overrides");
  });

  it("renames displayNameOverride to displayNameActive, value intact", () => {
    const account = activeFields(30).contributionAccounts["5"];
    expect(account.displayNameActive).toBe("Sean 401k");
    expect(account).not.toHaveProperty("displayNameOverride");
  });

  it("leaves every other key on that same account untouched", () => {
    const account = activeFields(30).contributionAccounts["5"];
    expect(account.contributionValue).toBe("0.2");
    expect(account.contributionMethod).toBe("percent_of_salary");
    expect(account.isActive).toBe(true);
  });

  it("leaves an account with no displayNameOverride alone", () => {
    expect(activeFields(31).contributionAccounts["6"]).toEqual({
      contributionValue: "625",
      isActive: false,
    });
  });

  it("leaves the jobs map untouched", () => {
    expect(activeFields(31).jobs).toEqual({ "9": { employerName: "NewCorp" } });
  });

  it("leaves a profile with no contributionAccounts alone", () => {
    expect(activeFields(32)).toEqual({});
  });

  // No idempotency test here (unlike 0009's bonus-term strip): this
  // migration's first statement is a RENAME COLUMN, which cannot be
  // re-applied once the column no longer has its old name — a re-run would
  // fail at that statement before the JSON rewrite ever executes. Drizzle's
  // migration ledger prevents this from happening for real; there's no
  // failure mode here to guard against the way there was for a pure
  // data-reshape migration that could plausibly compose against
  // already-migrated rows.
});
