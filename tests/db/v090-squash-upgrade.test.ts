/**
 * The v0.9.0 squash on SQLite, end to end through the real migrator
 * (runSQLite): a fresh install, a v0.8.15 install (13 v0.8 journal rows),
 * a journal cleared by a failed run (at any journal entry) or dropped, and
 * an install older than v0.8.14 (each era the refusal names) — refused
 * before any backup or change.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  assertSupportedUpgradePath,
  runSQLite,
  schemaLabel,
  snapshotColumns,
  SQUASHED_LINE_TIP,
  UpgradePathError,
} from "../../db-migrate";

const FOLDER = "drizzle-sqlite";
const journal = JSON.parse(
  fs.readFileSync(path.join(FOLDER, "meta", "_journal.json"), "utf8"),
) as { entries: { idx: number; tag: string }[] };
const hashOf = (tag: string) =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(FOLDER, `${tag}.sql`), "utf8"))
    .digest("hex");

function exec(db: Database.Database, tag: string) {
  const sql = fs.readFileSync(path.join(FOLDER, `${tag}.sql`), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint"))
    if (stmt.trim()) db.exec(stmt);
}

let dir: string;
let dbPath: string;
const env = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-squash-"));
  dbPath = path.join(dir, "ledgr.db");
  process.env.SQLITE_PATH = dbPath;
  process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
  delete process.env.LEDGR_SKIP_PREMIGRATION_BACKUP;
});
afterEach(() => {
  process.env = { ...env };
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A database at the v0.8.15 schema (the baseline) with a household row and
 *  `rows` fake v0.8 journal rows (hashes v0.9 doesn't know). */
function v0815(rows: number, mutate?: (db: Database.Database) => void) {
  const db = new Database(dbPath);
  exec(db, "0000_v9_initial_schema");
  db.exec(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
  );
  for (let i = 0; i < rows; i++)
    db.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    ).run(`v08-${i}`, String(i));
  db.exec(
    "INSERT INTO people (id, name, date_of_birth) VALUES (1, 'Alex', '1990-01-01')",
  );
  mutate?.(db);
  db.close();
}

const read = () => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return {
      hashes: (
        db
          .prepare("SELECT hash FROM __drizzle_migrations ORDER BY id")
          .all() as {
          hash: string;
        }[]
      ).map((r) => r.hash),
      people: (
        db.prepare("SELECT count(*) AS n FROM people").get() as { n: number }
      ).n,
      hasDebts: !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE name = 'debts'")
        .get(),
    };
  } finally {
    db.close();
  }
};
const backups = () =>
  fs.existsSync(process.env.LEDGR_BACKUP_DIR!)
    ? fs
        .readdirSync(process.env.LEDGR_BACKUP_DIR!)
        .filter((f) => f.startsWith("pre-upgrade-backup-"))
    : [];
const allHashes = journal.entries.map((e) => hashOf(e.tag));

describe("v0.9.0 squash (SQLite, real migrator)", () => {
  it("a fresh install records exactly the five journal entries, no backup", () => {
    runSQLite();
    expect(read().hashes).toEqual(allHashes);
    expect(backups()).toEqual([]);
  });

  it("a v0.8.15 install (13 journal rows) squashes to five, keeps its data, backs up first", () => {
    v0815(13);
    runSQLite();
    const after = read();
    expect(after.hashes).toEqual(allHashes);
    expect(after.people).toBe(1);
    expect(after.hasDebts).toBe(true);
    expect(backups()).toHaveLength(1);
    // A second start changes nothing.
    runSQLite();
    expect(read().hashes).toEqual(allHashes);
    expect(backups()).toHaveLength(1);
  });

  it("a journal cleared by an earlier failed run recovers, with a backup", () => {
    v0815(0);
    runSQLite();
    expect(read().hashes).toEqual(allHashes);
    expect(backups()).toHaveLength(1);
  });

  it("an install older than v0.8.14 is refused — journal, schema and data untouched, no backup", () => {
    v0815(13, (db) =>
      db.exec("ALTER TABLE account_performance DROP COLUMN note"),
    );
    expect(() => runSQLite()).toThrow(UpgradePathError);
    expect(() => runSQLite()).toThrow(/update to v0\.8\.15 first/);
    const after = read();
    expect(after.hashes).toHaveLength(13);
    expect(after.hasDebts).toBe(false);
    expect(after.people).toBe(1);
    expect(backups()).toEqual([]);
  });
});

/** A database at journal entry `idx` (every file up to it run), one
 *  household row, and a migration table that is empty or absent. */
function atEntry(idx: number, journalTable: "cleared" | "dropped") {
  const db = new Database(dbPath);
  for (const e of journal.entries) if (e.idx <= idx) exec(db, e.tag);
  if (journalTable === "cleared")
    db.exec(
      "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
    );
  db.exec(
    "INSERT INTO people (id, name, date_of_birth) VALUES (1, 'Alex', '1990-01-01')",
  );
  db.close();
}
const tables = () => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((r) => r.name);
  } finally {
    db.close();
  }
};
const latestIdx = journal.entries.at(-1)!.idx;

describe("a cleared or dropped migration table (SQLite, real migrator)", () => {
  // 0015 drops holding_observations.performance_account_id, a baseline
  // column: a database past it must not read as older than the baseline.
  it.each(journal.entries.map((e) => [e.tag, e.idx] as const))(
    "a journal cleared at %s recovers through the replay, with a backup",
    (_tag, idx) => {
      atEntry(idx, "cleared");
      runSQLite();
      const after = read();
      expect(after.hashes).toEqual(allHashes);
      expect(after.people).toBe(1);
      expect(backups()).toHaveLength(1);
    },
  );

  it.each([
    ["the baseline", 0],
    ["the latest entry", latestIdx],
  ] as const)(
    "a migration table dropped at %s is no older era: the strict apply stops with nothing changed, the next start replays",
    (_at, idx) => {
      atEntry(idx, "dropped");
      let message = "";
      try {
        runSQLite();
      } catch (err) {
        expect(err).not.toBeInstanceOf(UpgradePathError);
        message = (err as Error).message;
      }
      expect(message).toMatch(/already exists/);
      // The strict apply created the empty migration table before it ran,
      // so the next start is a cleared journal.
      expect(read()).toMatchObject({ hashes: [], people: 1 });
      runSQLite();
      expect(read()).toMatchObject({ hashes: allHashes, people: 1 });
    },
  );

  // Each era the refusal names (detectSchemaEraSqlite), from a database
  // short of the baseline. The older-era refusal comes first, with or
  // without a migration table.
  it.each([
    [
      "0004_v085_investments",
      (db: Database.Database) => {
        exec(db, "0000_v9_initial_schema");
        db.exec("ALTER TABLE account_performance DROP COLUMN note");
      },
    ],
    [
      "v0.7_final",
      (db: Database.Database) => {
        db.exec(
          "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
        );
        db.exec(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('dc91abbd28dd17fc654c9712fb27ce8f922708ccaaad7a4d68acbc19d8a7c685', '0')",
        );
      },
    ],
    [
      "v0.6_final",
      (db: Database.Database) =>
        db.exec("CREATE TABLE account_holdings (id INTEGER PRIMARY KEY)"),
    ],
    [
      "v0.5_final",
      (db: Database.Database) =>
        db.exec(
          "CREATE TABLE annual_performance (id INTEGER PRIMARY KEY, is_immutable INTEGER)",
        ),
    ],
    [
      "v0.3_final",
      (db: Database.Database) =>
        db.exec("CREATE TABLE projection_overrides (id INTEGER PRIMARY KEY)"),
    ],
    ["v0.2_final", () => {}],
  ] as const)(
    "a database older than the baseline names its era (%s) and is refused",
    (era, build) => {
      const db = new Database(dbPath);
      build(db);
      if (
        !db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'people'").get()
      )
        db.exec(
          "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, date_of_birth TEXT NOT NULL)",
        );
      db.close();
      const before = tables();
      expect(() => runSQLite()).toThrow(
        `This database is from an older Ledgr (schema ${era}).`,
      );
      expect(tables()).toEqual(before);
      expect(backups()).toEqual([]);
    },
  );
});

describe("assertSupportedUpgradePath on each dialect's journal", () => {
  const asDatabase = (cols: Map<string, string[]>) =>
    new Map([...cols].map(([t, c]) => [t, new Set(c)]));
  describe.each(["drizzle", "drizzle-sqlite"])("%s", (folder) => {
    const own = JSON.parse(
      fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const check = (recorded: Set<string>, actual: Map<string, Set<string>>) =>
      assertSupportedUpgradePath(
        own,
        folder,
        recorded,
        actual,
        crypto,
        () => "an invented era",
      );

    it.each(own.entries.map((e) => [e.tag, e.idx] as const))(
      "a database at %s with nothing recorded passes",
      (_tag, idx) => {
        expect(() =>
          check(new Set(), asDatabase(snapshotColumns(folder, idx))),
        ).not.toThrow();
      },
    );

    it("a database short of a baseline column no entry drops is older", () => {
      const at = asDatabase(snapshotColumns(folder, own.entries.at(-1)!.idx));
      at.get("account_performance")!.delete("note");
      expect(() => check(new Set(), at)).toThrow(
        /older Ledgr \(schema an invented era\).*Missing: account_performance\.note\.$/,
      );
    });

    it("a fresh database passes", () => {
      expect(() => check(new Set(), new Map())).not.toThrow();
    });

    // An image swapped back after a newer release migrated the database.
    const ownHashes = own.entries.map((e) =>
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(folder, `${e.tag}.sql`), "utf8"))
        .digest("hex"),
    );
    const latest = () =>
      asDatabase(snapshotColumns(folder, own.entries.at(-1)!.idx));
    it("a database recording every entry and one more is from a newer release", () => {
      expect(() =>
        check(new Set([...ownHashes, "a-newer-release"]), latest()),
      ).toThrow(
        /^This database was upgraded by a newer Ledgr: it records 1 migration\(s\) this release doesn't have\./,
      );
    });
    it("a database recording every entry and nothing more passes", () => {
      expect(() => check(new Set(ownHashes), latest())).not.toThrow();
    });
    it("a database short of one entry with others recorded is not refused as newer", () => {
      expect(() =>
        check(
          new Set([...ownHashes.slice(0, -1), "an-edited-entry"]),
          latest(),
        ),
      ).not.toThrow();
    });
  });
});

describe("schemaLabel — what a pre-squash backup is labelled", () => {
  const columns = (build: (db: Database.Database) => void) => {
    const db = new Database(":memory:");
    build(db);
    const m = new Map<string, Set<string>>();
    for (const r of db
      .prepare(
        "SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'",
      )
      .all() as { t: string; c: string }[]) {
      if (!m.has(r.t)) m.set(r.t, new Set());
      m.get(r.t)!.add(r.c);
    }
    db.close();
    return m;
  };
  const baselineOnly = columns((db) => exec(db, "0000_v9_initial_schema"));
  const allApplied = columns((db) => {
    for (const e of journal.entries) exec(db, e.tag);
  });

  it("v0.8.15 (no v0.9 hash recorded, baseline schema) → the squashed line's tip", () => {
    expect(schemaLabel(journal, FOLDER, new Set(), baselineOnly, crypto)).toBe(
      SQUASHED_LINE_TIP,
    );
  });

  it("a dev database on the v0.9 migrations → the last one recorded", () => {
    expect(
      schemaLabel(
        journal,
        FOLDER,
        new Set([hashOf("0004_v090_debts")]),
        allApplied,
        crypto,
      ),
    ).toBe("0004_v090_debts");
  });

  it("nothing recorded but the v0.9 columns present → by shape", () => {
    // The newest migration whose tables and columns match — a label, not a
    // record of what ran (0007 and 0014 are data only, 0009 indexes only).
    expect(schemaLabel(journal, FOLDER, new Set(), allApplied, crypto)).toBe(
      "0015_v0102_dead_data",
    );
  });

  it("a database not yet past a dropped column is labelled before the drop", () => {
    // 0015 drops holding_observations.performance_account_id: a database
    // that still has it is at 0014's shape, whatever else matches.
    const at0014 = new Map(
      [...allApplied].map(([t, cols]) => [t, new Set(cols)]),
    );
    at0014.get("holding_observations")!.add("performance_account_id");
    expect(schemaLabel(journal, FOLDER, new Set(), at0014, crypto)).toBe(
      "0014_v0102_display_name_custom",
    );
  });
});
