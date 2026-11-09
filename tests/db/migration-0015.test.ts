/**
 * Migration 0015 on SQLite, through the real migrator: holding observations
 * lose performance_account_id (the table is recreated, its rows, indexes and
 * foreign keys kept), the dead settings go, and a row that has no SimpleFIN
 * account stops the migration with nothing changed. The PostgreSQL file runs
 * in migration-0015-postgres.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import { DEAD_SETTING_KEYS } from "@/lib/db/migrate/v0102-dead-data";

const TAG = "0015_v0102_dead_data";
const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";

describe("migration 0015 through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");
  let shipped: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-0015-"));
    fs.cpSync(path.join(REPO, FOLDER), path.join(dir, FOLDER), {
      recursive: true,
    });
    for (const data of ["tax-data", "reference-data"])
      fs.symlinkSync(path.join(REPO, data), path.join(dir, data));
    process.env.SQLITE_PATH = path.join(dir, "ledgr.db");
    process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
    delete process.env.LEDGR_SKIP_PREMIGRATION_BACKUP;
    process.chdir(dir);
    // An install one migration behind: the journal without 0015.
    shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    expect(journal.entries.map((e) => e.tag)).toContain(TAG);
    journal.entries.splice(
      journal.entries.findIndex((e) => e.tag === TAG),
      1,
    );
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();
  });
  afterEach(() => {
    process.chdir(REPO);
    process.env = { ...env };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(extra?: (db: Database.Database) => void) {
    const db = new Database(process.env.SQLITE_PATH!);
    db.exec(`
      INSERT INTO simplefin_accounts (id, external_account_id, org_name, account_name, last_balance)
        VALUES (3, 'ACT-INVENTED', 'Invented Brokerage', 'Invented IRA', '1000');
      INSERT INTO securities (id, name, kind) VALUES (7, 'Invented Index Fund', 'fund');
      INSERT INTO holding_observations (id, simplefin_account_id, security_id, balance_date, as_of, shares, source)
        VALUES (1, 3, 7, 1793400000, '2026-10-30', '12.5', 'simplefin'),
               (2, 3, 7, NULL, '2026-10-29', '12', 'simplefin');
    `);
    const ins = db.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?)",
    );
    for (const key of DEAD_SETTING_KEYS) ins.run(key, "true");
    ins.run("invented_live_key", '"kept"');
    extra?.(db);
    db.close();
  }
  const indexes = (db: Database.Database) =>
    (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'holding_observations' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

  it("converts a 0014 install as a pending migration; running the file again changes nothing", () => {
    seed();
    fs.writeFileSync(journalPath(), shipped);
    runSQLite();
    const db = new Database(process.env.SQLITE_PATH!);
    const state = () => ({
      columns: (
        db.prepare("PRAGMA table_info(holding_observations)").all() as {
          name: string;
          notnull: number;
        }[]
      ).map((c) => `${c.name}${c.notnull ? " not null" : ""}`),
      rows: db
        .prepare(
          "SELECT id, simplefin_account_id, security_id, balance_date, as_of, shares FROM holding_observations ORDER BY id",
        )
        .all(),
      indexes: indexes(db),
      settings: db
        .prepare("SELECT key, value FROM app_settings ORDER BY key")
        .all()
        .filter((r) => {
          const { key } = r as { key: string };
          return DEAD_SETTING_KEYS.has(key) || key.startsWith("invented_");
        }),
      fkProblems: db.prepare("PRAGMA foreign_key_check").all(),
    });
    const after = state();
    expect(after.columns).not.toContain("performance_account_id");
    expect(after.columns).toContain("simplefin_account_id not null");
    expect(after.rows).toEqual([
      {
        id: 1,
        simplefin_account_id: 3,
        security_id: 7,
        balance_date: 1793400000,
        as_of: "2026-10-30",
        shares: "12.5",
      },
      {
        id: 2,
        simplefin_account_id: 3,
        security_id: 7,
        balance_date: null,
        as_of: "2026-10-29",
        shares: "12",
      },
    ]);
    expect(after.indexes).toEqual([
      "holding_observations_security_idx",
      "holding_observations_simplefin_idx",
      "holding_observations_simplefin_report_idx",
    ]);
    expect(after.settings).toEqual([
      { key: "invented_live_key", value: '"kept"' },
    ]);
    expect(after.fkProblems).toEqual([]);
    // The foreign keys still hold after the recreate.
    expect(() =>
      db
        .prepare(
          "INSERT INTO holding_observations (simplefin_account_id, security_id, as_of, shares, source) VALUES (99, 7, '2026-10-31', '1', 'simplefin')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);

    // A squash replay runs the file again on a converted database.
    const sql = fs.readFileSync(path.join(dir, FOLDER, `${TAG}.sql`), "utf8");
    db.transaction(() => {
      for (const stmt of sql.split("--> statement-breakpoint"))
        if (stmt.trim()) db.exec(stmt);
    })();
    expect(state()).toEqual(after);
    db.close();
  });

  it("stops on a row with no SimpleFIN account and changes nothing", () => {
    seed((db) => {
      db.exec(`
        INSERT INTO performance_accounts (id, institution, account_type, account_label, ownership_type, parent_category)
          VALUES (4, 'Invented Bank', 'brokerage', 'Invented Taxable', 'individual', 'Portfolio');
        INSERT INTO holding_observations (id, simplefin_account_id, performance_account_id, security_id, as_of, shares, source)
          VALUES (3, NULL, 4, 7, '2026-10-30', '5', 'manual');
      `);
    });
    const snapshot = () => {
      const db = new Database(process.env.SQLITE_PATH!, { readonly: true });
      const out = {
        rows: db
          .prepare("SELECT * FROM holding_observations ORDER BY id")
          .all(),
        settings: db.prepare("SELECT key FROM app_settings ORDER BY key").all(),
        recorded: db.prepare("SELECT hash FROM __drizzle_migrations").all(),
      };
      db.close();
      return out;
    };
    const before = snapshot();
    fs.writeFileSync(journalPath(), shipped);
    expect(() => runSQLite()).toThrow(/NOT NULL/);
    expect(snapshot()).toEqual(before);
  });
});
