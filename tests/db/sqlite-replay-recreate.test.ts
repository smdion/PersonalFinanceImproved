/**
 * A replayed SQLite table recreate drops only what its own journal entry
 * drops. Through the real migrator (runSQLite):
 * - a database holding a holding_observations column this journal doesn't
 *   know (a newer release's, or one added by hand) keeps it and its value
 *   when the journal is replayed, cleared or longer than this one;
 * - every legitimate replay is unchanged: each recreate in the journal,
 *   replayed from the entry before it and from every later entry, keeps
 *   every value of every column it keeps, and drops only its own columns.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite, snapshotColumns } from "../../db-migrate";

const FOLDER = "drizzle-sqlite";
const journal = JSON.parse(
  fs.readFileSync(path.join(FOLDER, "meta", "_journal.json"), "utf8"),
) as { entries: { idx: number; tag: string }[] };
const sqlOf = (tag: string) =>
  fs.readFileSync(path.join(FOLDER, `${tag}.sql`), "utf8");
const allHashes = journal.entries.map((e) =>
  crypto.createHash("sha256").update(sqlOf(e.tag)).digest("hex"),
);
const latestIdx = journal.entries.at(-1)!.idx;

let dir: string;
let dbPath: string;
const env = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-replay-recreate-"));
  dbPath = path.join(dir, "ledgr.db");
  process.env.SQLITE_PATH = dbPath;
  process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
  delete process.env.LEDGR_SKIP_PREMIGRATION_BACKUP;
});
afterEach(() => {
  process.env = { ...env };
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A database at journal entry `idx` (every file up to it run), with
 *  `recorded` as its migration table's rows. */
function atEntry(idx: number, recorded: string[]): Database.Database {
  const db = new Database(dbPath);
  for (const e of journal.entries)
    if (e.idx <= idx)
      for (const stmt of sqlOf(e.tag).split("--> statement-breakpoint"))
        if (stmt.trim()) db.exec(stmt);
  db.exec(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
  );
  for (const hash of recorded)
    db.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    ).run(hash, "0");
  return db;
}

type Column = { name: string; type: string; pk: number };
const columnsOf = (db: Database.Database, table: string) =>
  db.prepare(`PRAGMA table_info("${table}")`).all() as Column[];
const keysOf = (db: Database.Database, table: string) =>
  db
    .prepare(
      'SELECT "table" AS parent, "from", "to" FROM pragma_foreign_key_list(?)',
    )
    .all(table) as { parent: string; from: string; to: string }[];

/** The value every row this test writes holds in `table.column`: never a
 *  column default, and a foreign key holds its parent row's key. */
function valueOf(
  db: Database.Database,
  table: string,
  column: string,
): unknown {
  const key = keysOf(db, table).find((k) => k.from === column);
  if (key) return valueOf(db, key.parent, key.to);
  const col = columnsOf(db, table).find((c) => c.name === column)!;
  if (col.pk && /INT/i.test(col.type)) return 1;
  if (/INT/i.test(col.type)) return 2;
  if (/REAL/i.test(col.type)) return 2.5;
  return `v:${table}.${column}`;
}

/** One row in `table` with valueOf in every column, its parents first. */
function fill(db: Database.Database, table: string, done = new Set<string>()) {
  if (done.has(table)) return;
  done.add(table);
  for (const k of keysOf(db, table)) fill(db, k.parent, done);
  const cols = columnsOf(db, table).map((c) => c.name);
  db.prepare(
    `INSERT OR IGNORE INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
  ).run(...cols.map((c) => valueOf(db, table, c)));
}

const rowOf = (table: string) => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return {
      row: db.prepare(`SELECT * FROM "${table}"`).all() as Record<
        string,
        unknown
      >[],
      hashes: (
        db
          .prepare("SELECT hash FROM __drizzle_migrations ORDER BY id")
          .all() as {
          hash: string;
        }[]
      ).map((r) => r.hash),
    };
  } finally {
    db.close();
  }
};

/** The events (and their fields) the migrator logged while `run` ran. */
function logged(run: () => void): Record<string, unknown>[] {
  const spy = vi.spyOn(console, "log");
  try {
    run();
    return spy.mock.calls.map((c) => JSON.parse(String(c[0])));
  } finally {
    spy.mockRestore();
  }
}

describe("a holding_observations column this journal doesn't know", () => {
  /** A database at the latest entry, then a column a newer
   *  release (or a hand edit) added, holding a value. */
  function probe(recorded: string[]) {
    const db = atEntry(latestIdx, recorded);
    db.pragma("foreign_keys = OFF");
    fill(db, "holding_observations");
    db.exec("ALTER TABLE holding_observations ADD COLUMN future_col TEXT");
    db.exec("UPDATE holding_observations SET future_col = 'KEEP-ME'");
    db.close();
  }

  it.each([
    ["a cleared journal", [] as string[]],
    [
      "a journal longer than this one (an image rollback)",
      [...allHashes, "a-newer-release"],
    ],
  ])(
    "%s: the replay keeps the column and its value, and says so",
    (_shape, recorded) => {
      probe(recorded);
      const events = logged(() => runSQLite());
      expect(events.map((e) => e.event)).toContain(
        "sqlite_squash_upgrade_complete",
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          event: "squash_recreate_skipped",
          table: "holding_observations",
          reason: "would drop future_col",
        }),
      );
      const after = rowOf("holding_observations");
      expect(after.row).toHaveLength(1);
      expect(after.row[0]).toMatchObject({
        future_col: "KEEP-ME",
        shares: "v:holding_observations.shares",
      });
      expect(after.hashes).toEqual(allHashes);
    },
  );
});

// Each recreate in the journal, found from the SQL, with the columns its
// own entry drops.
const recreates = journal.entries.flatMap((e) =>
  [...sqlOf(e.tag).matchAll(/CREATE TABLE `__new_([^`]+)`/g)].map((m) => {
    const table = m[1]!;
    const kept = snapshotColumns(FOLDER, e.idx).get(table)!;
    return {
      tag: e.tag,
      idx: e.idx,
      table,
      drops: snapshotColumns(FOLDER, e.idx - 1)
        .get(table)!
        .filter((c) => !kept.includes(c)),
    };
  }),
);

describe("every legitimate recreate replay is unchanged", () => {
  it("the journal has the recreates this test is about", () => {
    expect(recreates.map((r) => `${r.tag}:${r.table}`)).toEqual([
      "0005_v092_filing_status_auto:retirement_settings",
      "0015_v0102_dead_data:holding_observations",
    ]);
  });

  const cases = recreates.flatMap((r) =>
    journal.entries
      .filter((e) => e.idx >= r.idx - 1)
      .map((e) => [r.tag, r.table, e.tag, r, e.idx] as const),
  );
  it.each(cases)(
    "%s (%s) replayed on a cleared journal at %s keeps every value it keeps",
    (_tag, table, _at, recreate, at) => {
      const db = atEntry(at, []);
      db.pragma("foreign_keys = OFF");
      fill(db, table);
      const before = db.prepare(`SELECT * FROM "${table}"`).get() as Record<
        string,
        unknown
      >;
      db.close();
      runSQLite();
      const after = rowOf(table);
      expect(after.hashes).toEqual(allHashes);
      expect(after.row).toHaveLength(1);
      const row = after.row[0]!;
      // Before the recreate it runs and drops its own columns; past it the
      // table is untouched. Every other column keeps its value.
      const dropped = at < recreate.idx ? recreate.drops : [];
      for (const c of dropped) expect(row).not.toHaveProperty(c);
      const kept = Object.fromEntries(
        Object.entries(before).filter(([c]) => !dropped.includes(c)),
      );
      expect(row).toMatchObject(kept);
      const db2 = new Database(dbPath, { readonly: true });
      expect(db2.pragma("foreign_key_check")).toEqual([]);
      db2.close();
    },
  );
});
