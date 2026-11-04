/**
 * scripts/check-constraints.ts: the committed lists of primary keys,
 * foreign keys and indexes, and the check that compares a database with
 * them. The SQLite cases run the real script (a child process) on a
 * database the real migrator built from empty; the PostgreSQL half runs in
 * CI's PostgreSQL job.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  compareSnapshot,
  foreignKeyLine,
  formatSnapshot,
  indexLine,
  parseSnapshot,
  pgAction,
  primaryKeyLine,
  snapshotPath,
  sqliteForeignKeyLines,
} from "../../scripts/check-constraints";
import { runMigrator } from "../routers/fresh-install-cases";

const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");

describe("constraint lines", () => {
  it("prints a foreign key with its actions spelled out", () => {
    expect(
      foreignKeyLine({
        table: "jobs",
        columns: ["person_id"],
        refTable: "people",
        refColumns: ["id"],
        onDelete: pgAction("r"),
        onUpdate: pgAction("a"),
      }),
    ).toBe(
      "jobs: foreign key (person_id) references people(id) on delete restrict on update no action",
    );
  });

  it("refuses an unknown PostgreSQL action code", () => {
    expect(() => pgAction("x")).toThrow(/x/);
  });

  it("groups SQLite's per-column foreign key rows into one line per key", () => {
    const lines = sqliteForeignKeyLines(
      "pairs",
      [
        {
          id: 0,
          seq: 1,
          table: "grid",
          from: "b",
          to: "y",
          on_update: "NO ACTION",
          on_delete: "CASCADE",
        },
        {
          id: 0,
          seq: 0,
          table: "grid",
          from: "a",
          to: "x",
          on_update: "NO ACTION",
          on_delete: "CASCADE",
        },
        {
          id: 1,
          seq: 0,
          table: "people",
          from: "owner_id",
          to: null,
          on_update: "NO ACTION",
          on_delete: "SET NULL",
        },
      ],
      () => ["id"],
    );
    expect(lines.sort()).toEqual([
      "pairs: foreign key (a, b) references grid(x, y) on delete cascade on update no action",
      "pairs: foreign key (owner_id) references people(id) on delete set null on update no action",
    ]);
  });

  it("marks unique, partial and non-btree indexes", () => {
    expect(
      indexLine({
        table: "jobs",
        name: "jobs_one_idx",
        columns: ["person_id"],
        unique: true,
        partial: true,
        method: "btree",
      }),
    ).toBe("jobs: unique index jobs_one_idx (person_id) partial");
    expect(
      indexLine({
        table: "t",
        name: "t_doc_idx",
        columns: ["doc"],
        unique: false,
        partial: false,
        method: "gin",
      }),
    ).toBe("t: index t_doc_idx (doc) using gin");
    expect(primaryKeyLine("t", ["a", "b"])).toBe("t: primary key (a, b)");
  });

  it("reads back what it writes, and names what's missing and unexpected", () => {
    const lines = ["b: primary key (id)", "a: primary key (id)"];
    expect(parseSnapshot(formatSnapshot(lines))).toEqual([...lines].sort());
    expect(
      compareSnapshot(
        ["a: primary key (id)", "b: primary key (id)"],
        ["a: primary key (id)", "c: primary key (id)"],
      ),
    ).toEqual({
      missing: ["b: primary key (id)"],
      unexpected: ["c: primary key (id)"],
    });
  });
});

describe("the committed lists", () => {
  it("are the same on both dialects", () => {
    // The SQLite schema is generated from the PostgreSQL one, so the two
    // lists agree; a dialect-only constraint would be a deliberate
    // exception named here.
    const read = (dialect: "postgresql" | "sqlite") =>
      parseSnapshot(fs.readFileSync(snapshotPath(dialect), "utf8"));
    expect(read("sqlite")).toEqual(read("postgresql"));
  });
});

describe("check-constraints on SQLite", () => {
  let dir: string;
  const env = { ...process.env };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-constraints-test-"));
    process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
    delete process.env.DATABASE_URL;
  });
  afterAll(() => {
    process.env = { ...env };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Run the check; `args` may name an existing database. */
  function check(args: string[] = []) {
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    delete childEnv.DATABASE_URL;
    for (const key of Object.keys(childEnv))
      if (key.startsWith("VITEST")) delete childEnv[key];
    return spawnSync(TSX, ["scripts/check-constraints.ts", ...args], {
      cwd: process.cwd(),
      env: childEnv,
      encoding: "utf8",
      timeout: 180_000,
    });
  }

  /** A database at the current schema, built by the real migrator. */
  function migrated(name: string): string {
    const dbPath = path.join(dir, name);
    runMigrator({ SQLITE_PATH: dbPath });
    return dbPath;
  }

  it("passes on a database migrated from empty", () => {
    const result = check();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Constraints match/);
  }, 60_000);

  it("fails, naming it, when a migration drops an index", () => {
    const dbPath = migrated("dropped-index.db");
    const db = new Database(dbPath);
    db.exec("DROP INDEX jobs_person_id_idx");
    db.close();
    const result = check([`--sqlite-path=${dbPath}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "missing:    jobs: index jobs_person_id_idx (person_id)",
    );
  }, 60_000);

  it("fails, naming it, when a migration drops a foreign key", () => {
    // SQLite can't drop a foreign key in place: a migration rebuilds the
    // table without it, as here.
    const dbPath = migrated("dropped-fk.db");
    const db = new Database(dbPath);
    const tableSql = (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs'",
        )
        .get() as { sql: string }
    ).sql;
    const indexSql = (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'jobs' AND sql IS NOT NULL",
        )
        .all() as { sql: string }[]
    ).map((row) => row.sql);
    const withoutForeignKey = tableSql
      .replace(
        /,\s*FOREIGN KEY \(`person_id`\) REFERENCES `people`\(`id`\)[^,)]*/,
        "",
      )
      .replace(/^CREATE TABLE [`"]?jobs[`"]?/, "CREATE TABLE `jobs_rebuilt`");
    expect(withoutForeignKey).not.toContain("REFERENCES `people`");
    db.pragma("foreign_keys = OFF");
    db.exec(withoutForeignKey);
    db.exec("INSERT INTO jobs_rebuilt SELECT * FROM jobs");
    db.exec("DROP TABLE jobs");
    db.exec("ALTER TABLE jobs_rebuilt RENAME TO jobs");
    for (const sql of indexSql) db.exec(sql);
    db.close();

    const result = check([`--sqlite-path=${dbPath}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "missing:    jobs: foreign key (person_id) references people(id) on delete restrict on update no action",
    );
    expect(result.stderr).not.toContain("unexpected:");
  }, 60_000);
});
