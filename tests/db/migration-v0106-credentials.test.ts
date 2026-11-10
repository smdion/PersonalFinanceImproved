/**
 * The credentials tag through the real SQLite migrator: an install at the
 * tag before it gets every stored credential of credentials-cases.ts
 * encrypted (or unwrapped), its stored versions' copies too, as a pending
 * migration and in either squash replay, twice over; run again over its
 * own output it writes nothing, nor does the whole registry run again at
 * the head; the restore step gives the rows SQLite gives; without
 * ENCRYPTION_KEY the start is refused and nothing changes. Every IV is
 * fixed here, so the restore and SQLite encrypt a value to the same text.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import {
  CREDENTIALS_CONVERTER,
  CREDENTIALS_TAG,
} from "@/lib/db/migrate/v0106-credentials";
import { MigrationRefusal } from "@/lib/db/migrate/converter-refusal";
import {
  expectRegistryReplaySafe,
  expectRestoreMatchesSqlite,
  expectSqliteReplaySafe,
} from "./converter-replay";
import {
  CONNECTIONS,
  KEY_TEXT,
  OTHER_TABLE_ROWS,
  SECRETS,
  VERSION_COPIES,
  expectConverted,
  expectCopiesConverted,
} from "./credentials-cases";

vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomBytes: (size: number) => Buffer.alloc(size, 7),
}));

const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";

describe("the credentials tag through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-credentials-"));
    fs.cpSync(path.join(REPO, FOLDER), path.join(dir, FOLDER), {
      recursive: true,
    });
    for (const data of ["tax-data", "reference-data"])
      fs.symlinkSync(path.join(REPO, data), path.join(dir, data));
    process.env.SQLITE_PATH = path.join(dir, "ledgr.db");
    process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
    process.env.ENCRYPTION_KEY = KEY_TEXT;
    delete process.env.LEDGR_SKIP_PREMIGRATION_BACKUP;
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(REPO);
    process.env = { ...env };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** An install migrated to just before the tag, holding the cases' rows
   *  (SQLite keeps JSON as text); the journal is then the shipped one. */
  function installBefore() {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === CREDENTIALS_TAG);
    expect(at).toBeGreaterThan(0);
    journal.entries.splice(at);
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();
    const db = open();
    const connection = db.prepare(
      "INSERT INTO api_connections (id, service, config) VALUES (?, ?, ?)",
    );
    for (const c of CONNECTIONS)
      connection.run(c.id, c.service, JSON.stringify(c.stored));
    const version = db.prepare(
      "INSERT INTO state_versions (id, name, version_type, schema_version, table_count, total_rows, created_by) VALUES (?, 'Invented', 'manual', '0017_v0102_match_value', 2, 5, 'invented')",
    );
    const copy = db.prepare(
      "INSERT INTO state_version_tables (id, version_id, table_name, row_count, data) VALUES (?, ?, ?, ?, ?)",
    );
    const copies = Object.values(VERSION_COPIES);
    version.run(1);
    version.run(2);
    copy.run(1, 1, "api_connections", 4, JSON.stringify(copies));
    copy.run(2, 1, "people", 1, JSON.stringify(OTHER_TABLE_ROWS));
    copy.run(3, 2, "api_connections", 4, JSON.stringify(copies));
    db.close();
    fs.writeFileSync(journalPath(), shipped);
  }

  /** Each config and version copy as the app reads it (JSON text parsed). */
  const state = () => {
    const db = open();
    const configs = new Map(
      (
        db.prepare("SELECT id, config FROM api_connections").all() as {
          id: number;
          config: string;
        }[]
      ).map((r): [number, unknown] => [r.id, JSON.parse(r.config)]),
    );
    const versions = (
      db
        .prepare(
          "SELECT id, table_name, data FROM state_version_tables ORDER BY id",
        )
        .all() as { id: number; table_name: string; data: string }[]
    ).map((r) => ({ ...r, data: JSON.parse(r.data) as unknown[] }));
    const recorded = (
      db.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
        n: number;
      }
    ).n;
    db.close();
    return { configs, versions, recorded };
  };

  function expectAllConverted(s: ReturnType<typeof state>) {
    expectConverted(s.configs);
    const [first, other, second] = s.versions;
    expectCopiesConverted(first!.data);
    expectCopiesConverted(second!.data);
    expect(other!.data).toEqual(OTHER_TABLE_ROWS);
  }

  it("converts as a pending migration, and a later start changes nothing", () => {
    installBefore();
    runSQLite();
    const first = state();
    expectAllConverted(first);
    runSQLite();
    expect(state()).toEqual(first);
  });

  it.each([
    [
      "a recorded hash that no longer matches",
      "UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM __drizzle_migrations)",
    ],
    ["a cleared journal", "DELETE FROM __drizzle_migrations"],
  ])("a squash replay (%s) twice over changes nothing", (_, damage) => {
    installBefore();
    runSQLite();
    const converted = state();
    expectAllConverted(converted);
    for (let run = 0; run < 2; run++) {
      const db = open();
      db.exec(damage);
      db.close();
      runSQLite();
      const after = state();
      expect(after.configs).toEqual(converted.configs);
      expect(after.versions).toEqual(converted.versions);
    }
  });

  it("run twice more over its own output, it writes nothing", () => {
    installBefore();
    runSQLite();
    const db = open();
    expectSqliteReplaySafe(db, [CREDENTIALS_CONVERTER]);
    db.close();
  });

  it("the whole registry run again at the head writes nothing", () => {
    installBefore();
    runSQLite();
    const db = open();
    expectRegistryReplaySafe(db);
    db.close();
  });

  it("the restore step gives the rows SQLite gives", () => {
    runSQLite();
    const db = open();
    expectRestoreMatchesSqlite(db, [CREDENTIALS_CONVERTER], {
      api_connections: CONNECTIONS.map((c) => ({
        id: c.id,
        service: c.service,
        config: JSON.stringify(c.stored),
      })),
      state_versions: [1, 2].map((id) => ({
        id,
        name: "Invented",
        version_type: "manual",
        schema_version: "0017_v0102_match_value",
        table_count: 2,
        total_rows: 5,
        created_by: "invented",
      })),
      state_version_tables: [
        [1, 1, "api_connections", Object.values(VERSION_COPIES)],
        [2, 1, "people", OTHER_TABLE_ROWS],
        [3, 2, "api_connections", Object.values(VERSION_COPIES)],
      ].map(([id, versionId, table, data]) => ({
        id,
        version_id: versionId,
        table_name: table,
        row_count: 4,
        data: JSON.stringify(data),
      })),
    });
    db.close();
  });

  it("without ENCRYPTION_KEY the start is refused, naming no value, and nothing changes", () => {
    installBefore();
    const before = state();
    delete process.env.ENCRYPTION_KEY;
    let refusal: unknown = null;
    try {
      runSQLite();
    } catch (e) {
      refusal = e;
    }
    expect(refusal).toBeInstanceOf(MigrationRefusal);
    const message = (refusal as Error).message;
    expect(message).toMatch(
      /^Stored credentials must be encrypted, and ENCRYPTION_KEY is missing .*Nothing was changed\./,
    );
    for (const secret of SECRETS) expect(message).not.toContain(secret);
    expect(state()).toEqual(before);
  });
});
