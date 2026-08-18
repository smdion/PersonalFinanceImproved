/**
 * `0011_contribution_accounts_no_base_value`, applied after every prior
 * migration (including 0010).
 *
 * Drops `contribution_accounts.contribution_value`/`contribution_method` —
 * an account is purely structural from here on; the real number always
 * lives in a Contribution Profile's active fields. Before dropping the
 * columns, the migration backfills every profile's `contributionAccounts`
 * map with each account's current live value, filling in ONLY what's
 * missing so an existing partial customization (a profile that already set
 * just `contributionValue`, matching the real household's shape) is never
 * clobbered — it just gets its missing `contributionMethod` filled in.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const MIGRATION_TAG = "0011_contribution_accounts_no_base_value";
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
    // Some prior migration's ALTER TABLE table-rebuild resets this back to
    // SQLite's compiled-in default (ON) — re-disable before seeding rows
    // that reference nonexistent people/job ids, same as the 0010 test.
    db.pragma("foreign_keys = OFF");

    // ---- Pre-migration data, under the old live-value columns ----
    // Account 1: no entry in any profile — full backfill expected.
    // Account 2: "2031 more travel"-shaped — profile already sets only
    //   contributionValue, no contributionMethod (a real production row).
    // Account 3: a profile already fully customizes it — must survive
    //   byte-for-byte, migration is a no-op for that entry.
    db.exec(`
      INSERT INTO contribution_accounts
        (id, person_id, account_type, parent_category, tax_treatment,
         contribution_method, contribution_value, employer_match_type,
         auto_maximize, is_active, ownership, allocation_priority) VALUES
        (101, 1, '401k', 'Retirement', 'pre_tax', 'percent_of_salary', '14.00', 'none', 0, 1, 'individual', 0),
        (102, NULL, 'ira', 'Retirement', 'tax_free', 'fixed_monthly', '625.00', 'none', 0, 1, 'joint', 0),
        (103, 2, 'hsa', 'Retirement', 'hsa', 'fixed_monthly', '400.00', 'none', 0, 1, 'individual', 0);

      DELETE FROM contribution_profiles;
      INSERT INTO contribution_profiles (id, name, contribution_active_fields) VALUES
        (201, 'YNAB Contribution', '{"contributionAccounts":{},"jobs":{}}'),
        (202, '2031 more travel', '{"contributionAccounts":{"102":{"contributionValue":"0"}},"jobs":{}}'),
        (203, 'Fully Customized', '{"contributionAccounts":{"103":{"contributionValue":"500","contributionMethod":"fixed_monthly","isActive":false}},"jobs":{}}');
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

  it("drops the base-value columns", () => {
    const cols = db
      .prepare("PRAGMA table_info(contribution_accounts)")
      .all() as Row[];
    const names = cols.map((c) => c.name);
    expect(names).not.toContain("contribution_value");
    expect(names).not.toContain("contribution_method");
  });

  it("fully backfills an account with no prior entry", () => {
    expect(activeFields(201).contributionAccounts["101"]).toEqual({
      contributionValue: "14.00",
      contributionMethod: "percent_of_salary",
    });
  });

  it("fills in only the missing field for a partially-customized account, preserving the profile's own value", () => {
    expect(activeFields(202).contributionAccounts["102"]).toEqual({
      contributionValue: "0",
      contributionMethod: "fixed_monthly",
    });
  });

  it("leaves a fully-customized entry byte-for-byte untouched", () => {
    expect(activeFields(203).contributionAccounts["103"]).toEqual({
      contributionValue: "500",
      contributionMethod: "fixed_monthly",
      isActive: false,
    });
  });

  it("backfills every account into every profile, not just the ones that already touched it", () => {
    // Profile 202 only had account 102 in its map pre-migration; it must now
    // also carry accounts 101 and 103 (their live values), matching the plan's
    // "migrate every profile, not just the active one" requirement.
    const accounts = activeFields(202).contributionAccounts;
    expect(accounts["101"]).toEqual({
      contributionValue: "14.00",
      contributionMethod: "percent_of_salary",
    });
    expect(accounts["103"]).toEqual({
      contributionValue: "400.00",
      contributionMethod: "fixed_monthly",
    });
  });
});
