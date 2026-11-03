/**
 * Pending migrations on SQLite, through the real migrator (runSQLite): a
 * statement that fails, or a migration that leaves the schema short of its
 * snapshot, stops the run with nothing recorded and nothing changed. Only a
 * squash replay may skip "already done" errors (v090-squash-upgrade.test.ts);
 * skipping them here once recorded a migration whose column was never added.
 *
 * Each test migrates a fresh database to the shipped journal, then adds one
 * invented migration to a copy of the migrations folder and migrates again.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";

const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";

type Journal = {
  entries: {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }[];
};
type Snapshot = {
  tables: Record<string, { name: string; columns: Record<string, unknown> }>;
};

let dir: string;
const env = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migrate-strict-"));
  fs.cpSync(path.join(REPO, FOLDER), path.join(dir, FOLDER), {
    recursive: true,
  });
  // The migrator reads its reference data from the working directory.
  for (const data of ["tax-data", "reference-data"])
    fs.symlinkSync(path.join(REPO, data), path.join(dir, data));
  process.env.SQLITE_PATH = path.join(dir, "ledgr.db");
  process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
  delete process.env.LEDGR_SKIP_PREMIGRATION_BACKUP;
  process.chdir(dir);
  runSQLite();
});
afterEach(() => {
  process.chdir(REPO);
  process.env = { ...env };
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Add one migration after the shipped ones: its SQL, and a snapshot that
 *  is the last shipped one plus `expectColumn` on `people`. */
function addMigration(sql: string, expectColumn: string) {
  const meta = path.join(dir, FOLDER, "meta");
  const journalPath = path.join(meta, "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
  const last = journal.entries.at(-1)!;
  const idx = last.idx + 1;
  const tag = `${String(idx).padStart(4, "0")}_invented_test_migration`;
  journal.entries.push({ ...last, idx, tag, when: Date.now() });
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  fs.writeFileSync(path.join(dir, FOLDER, `${tag}.sql`), sql);

  const pad = (n: number) => String(n).padStart(4, "0");
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(meta, `${pad(last.idx)}_snapshot.json`), "utf8"),
  ) as Snapshot;
  const people = Object.values(snapshot.tables).find(
    (t) => t.name === "people",
  )!;
  people.columns[expectColumn] = {
    name: expectColumn,
    type: "text",
    primaryKey: false,
    notNull: false,
    autoincrement: false,
  };
  fs.writeFileSync(
    path.join(meta, `${pad(idx)}_snapshot.json`),
    JSON.stringify(snapshot, null, 2),
  );
}

function state() {
  const db = new Database(process.env.SQLITE_PATH!, { readonly: true });
  try {
    return {
      recorded: (
        db.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
          n: number;
        }
      ).n,
      peopleColumns: (
        db.prepare("PRAGMA table_info(people)").all() as { name: string }[]
      ).map((c) => c.name),
    };
  } finally {
    db.close();
  }
}

describe("pending migrations apply strictly (SQLite, real migrator)", () => {
  it("a failing statement stops the run: nothing recorded, nothing changed", () => {
    const before = state();
    addMigration(
      "ALTER TABLE `people` ADD `nickname` text;--> statement-breakpoint\nUPDATE `no_such_table` SET `a` = 1;",
      "nickname",
    );
    expect(() => runSQLite()).toThrow(/no such table/);
    expect(state()).toEqual(before);
  });

  it("a migration that leaves the schema short of its snapshot is rolled back", () => {
    const before = state();
    // Runs cleanly, but adds the wrong column: the snapshot wants nickname.
    addMigration("ALTER TABLE `people` ADD `alias` text;", "nickname");
    expect(() => runSQLite()).toThrow(
      /Migration left the schema incomplete \(missing people\.nickname/,
    );
    expect(state()).toEqual(before);
  });

  it("with nothing pending, a schema short of the snapshot is reported, not fatal", () => {
    // An install the old migrator left short: a column it recorded but never
    // added. Starting again must not take the app down over it.
    const db = new Database(process.env.SQLITE_PATH!);
    db.exec("ALTER TABLE `people` DROP COLUMN `is_primary_user`");
    db.close();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => runSQLite()).not.toThrow();
      const reported = errors.mock.calls
        .map(
          ([line]) =>
            JSON.parse(String(line)) as { event: string; error: string },
        )
        .find((e) => e.event === "schema_incomplete");
      expect(reported?.error).toMatch(/people\.is_primary_user/);
    } finally {
      errors.mockRestore();
    }
  });

  it("a good migration is applied and recorded", () => {
    const before = state();
    addMigration("ALTER TABLE `people` ADD `nickname` text;", "nickname");
    runSQLite();
    const after = state();
    expect(after.recorded).toBe(before.recorded + 1);
    expect(after.peopleColumns).toContain("nickname");
  });
});
