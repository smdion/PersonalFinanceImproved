/**
 * `scripts/rotate-encryption-key.ts` on SQLite (the cases are in
 * ./rotate-encryption-key-cases, shared with PostgreSQL), plus the CLI run
 * as a child process: its keys and database come from `.env`-style variables.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import {
  decryptStringWithKey,
  encryptStringWithKey,
} from "@/lib/crypto-envelope";
import { rotateSqlite } from "../../scripts/rotate-encryption-key";
import {
  keyRotationCases,
  type RotationDatabase,
} from "./rotate-encryption-key-cases";

const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");

let dir: string;
const env = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-key-rotation-"));
  process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
  delete process.env.DATABASE_URL;
});
afterEach(() => {
  process.env = { ...env };
  fs.rmSync(dir, { recursive: true, force: true });
});

let databases = 0;
/** A fresh database at the current schema, through the real migrator. */
function freshDatabase(): string {
  const dbPath = path.join(dir, `rotation-${++databases}.db`);
  process.env.SQLITE_PATH = dbPath;
  runSQLite();
  return dbPath;
}

function sqliteRotation(dbPath: string): RotationDatabase {
  const withDb = <T>(fn: (db: Database.Database) => T): T => {
    const db = new Database(dbPath);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  };
  return {
    addConnection: async (id, service, config) =>
      withDb((db) => {
        db.prepare(
          "INSERT INTO api_connections (id, service, config) VALUES (?, ?, ?)",
        ).run(id, service, JSON.stringify(config));
      }),
    addVersion: async (versionId, rows) =>
      withDb((db) => {
        db.prepare(
          "INSERT INTO state_versions (id, name, version_type, schema_version, table_count, total_rows, created_by) VALUES (?, 'Invented', 'manual', 'test', 1, ?, 'test')",
        ).run(versionId, rows.length);
        db.prepare(
          "INSERT INTO state_version_tables (version_id, table_name, row_count, data) VALUES (?, 'api_connections', ?, ?)",
        ).run(versionId, rows.length, JSON.stringify(rows));
      }),
    configs: async () =>
      withDb((db) =>
        Object.fromEntries(
          db
            .prepare<[], { id: number; config: string }>(
              "SELECT id, config FROM api_connections",
            )
            .all()
            .map((r) => [r.id, JSON.parse(r.config)]),
        ),
      ),
    versionRows: async () =>
      withDb((db) =>
        db
          .prepare<[], { data: string }>(
            "SELECT data FROM state_version_tables WHERE table_name = 'api_connections' ORDER BY id",
          )
          .all()
          .flatMap((r) => JSON.parse(r.data)),
      ),
    rotate: async (keys, dryRun) =>
      withDb((db) => rotateSqlite(db, keys, dryRun)),
  };
}

describe("ENCRYPTION_KEY rotation (SQLite)", () => {
  // A SQLite version holds each row as SELECT * returns it: config is JSON text.
  keyRotationCases(
    "SQLite",
    async () => sqliteRotation(freshDatabase()),
    (envelope) => JSON.stringify(envelope),
  );

  it("the CLI reads both keys and the database from the environment", () => {
    const dbPath = freshDatabase();
    const oldKey = randomBytes(32);
    const nextKey = randomBytes(32);
    const db = new Database(dbPath);
    const token = JSON.stringify({ apiKey: "invented-key" });
    db.prepare(
      "INSERT INTO api_connections (service, config) VALUES ('tiingo', ?)",
    ).run(JSON.stringify(encryptStringWithKey(oldKey, token)));
    db.close();

    const run = (args: string[]) => {
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DATABASE_URL: "",
        SQLITE_PATH: dbPath,
        ENCRYPTION_KEY: oldKey.toString("base64"),
        ENCRYPTION_KEY_NEW: nextKey.toString("base64"),
      };
      for (const key of Object.keys(childEnv))
        if (key.startsWith("VITEST")) delete childEnv[key];
      return spawnSync(
        TSX,
        [path.join("scripts", "rotate-encryption-key.ts"), ...args],
        {
          cwd: process.cwd(),
          env: childEnv,
          encoding: "utf8",
          timeout: 120_000,
        },
      );
    };
    const stored = () => {
      const check = new Database(dbPath, { readonly: true });
      try {
        return JSON.parse(
          check
            .prepare<[], { config: string }>(
              "SELECT config FROM api_connections",
            )
            .get()!.config,
        );
      } finally {
        check.close();
      }
    };
    const before = stored();

    const dryRun = run(["--dry-run"]);
    expect(dryRun.status, dryRun.stderr).toBe(0);
    expect(dryRun.stderr).toContain(
      "Would re-encrypt 1 integration credential",
    );
    expect(stored()).toEqual(before);

    const rotated = run([]);
    expect(rotated.status, rotated.stderr).toBe(0);
    expect(decryptStringWithKey(nextKey, stored())).toBe(token);

    const again = run([]);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stderr).toContain("1 already under the new key");
    expect(decryptStringWithKey(nextKey, stored())).toBe(token);
  });
});
