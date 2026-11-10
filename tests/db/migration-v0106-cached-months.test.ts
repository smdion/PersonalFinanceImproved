/**
 * The credentials tag's cached-months step through the real SQLite
 * migrator: an install at the tag before it gets every cached month of the
 * active service harvested into savings_monthly once (never over a month
 * it holds) and every cached month purged, as a pending migration, and a
 * later start changes nothing; run again over its own output, and with the
 * whole registry at the head, it writes nothing; the restore step gives
 * the rows SQLite gives.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import { CREDENTIALS_TAG } from "@/lib/db/migrate/v0106-credentials";
import { CACHED_MONTHS_CONVERTER } from "@/lib/db/migrate/v0106-cached-months";
import {
  expectRegistryReplaySafe,
  expectRestoreMatchesSqlite,
  expectSqliteReplaySafe,
} from "./converter-replay";
import {
  CACHE,
  GOALS,
  HARVESTED,
  HELD,
  KEPT_CACHE_IDS,
  LINKS,
  SETTINGS,
} from "./cached-months-cases";

const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";

/** The cases' rows as SQLite holds them, parents first. */
const fixture = () => ({
  app_settings: SETTINGS.map((s) => ({ ...s, value: JSON.stringify(s.value) })),
  savings_goals: GOALS.map((g) => ({ ...g, is_active: Number(g.is_active) })),
  savings_goal_category_links: LINKS.map((l) => ({ ...l })),
  savings_monthly: HELD.map((h) => ({ ...h })),
  budget_api_cache: CACHE.map((c) => ({ ...c, data: JSON.stringify(c.data) })),
});

describe("the cached-months step through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-months-"));
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

  /** An install migrated to just before the tag, holding the cases' rows;
   *  the journal is then the shipped one. */
  function installBefore() {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === CREDENTIALS_TAG);
    expect(at).toBeGreaterThan(0);
    journal.entries.splice(at);
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();
    const db = open();
    for (const [table, rows] of Object.entries(fixture()))
      for (const row of rows) {
        const cols = Object.keys(row);
        db.prepare(
          `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        ).run(...Object.values(row));
      }
    db.close();
    fs.writeFileSync(journalPath(), shipped);
  }

  const state = () => {
    const db = open();
    const monthly = db
      .prepare(
        "SELECT id, goal_id, month_date, balance FROM savings_monthly ORDER BY id",
      )
      .all() as { id: number }[];
    const cache = (
      db.prepare("SELECT id FROM budget_api_cache ORDER BY id").all() as {
        id: number;
      }[]
    ).map((r) => r.id);
    db.close();
    return { monthly, cache };
  };

  it("harvests and purges as a pending migration, and a later start changes nothing", () => {
    installBefore();
    runSQLite();
    const first = state();
    expect(first.monthly[0]).toEqual(HELD[0]);
    expect(first.monthly.slice(1).map(({ id: _, ...rest }) => rest)).toEqual(
      HARVESTED,
    );
    expect(first.cache).toEqual(KEPT_CACHE_IDS);
    runSQLite();
    expect(state()).toEqual(first);
  });

  it("run twice more over its own output, and with the whole registry, it writes nothing", () => {
    installBefore();
    runSQLite();
    const db = open();
    expectSqliteReplaySafe(db, [CACHED_MONTHS_CONVERTER]);
    expectRegistryReplaySafe(db);
    db.close();
  });

  it("the restore step gives the rows SQLite gives", () => {
    runSQLite();
    const db = open();
    expectRestoreMatchesSqlite(db, [CACHED_MONTHS_CONVERTER], fixture());
    db.close();
  });
});
