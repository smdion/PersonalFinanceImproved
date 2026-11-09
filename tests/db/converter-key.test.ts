/**
 * The encryption key a converter asks for: read from ENCRYPTION_KEY only
 * when asked (an install with nothing to encrypt starts without one), so
 * after db-migrate.ts's run() has loaded .env; missing or malformed, it
 * refuses the start without printing the key, and the whole migration
 * rolls back. The same holds on the restore path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import type { DataConverter } from "@/lib/db/migrate/migration-converters";
import { MigrationRefusal } from "@/lib/db/migrate/converter-refusal";
import {
  decryptStringWithKey,
  isEncryptedEnvelope,
} from "@/lib/crypto-envelope";
import { encrypts, renames } from "./converter-list-cases";

const hook = vi.hoisted(() => ({
  converters: {} as Record<string, DataConverter | DataConverter[]>,
}));
vi.mock("@/lib/db/migrate/migration-converters", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MIGRATION_CONVERTERS: hook.converters,
}));

import { convertBackup } from "@/lib/db/migrate/migration-converters";
import { runSQLite } from "../../db-migrate";

const TAG = "0015_v0102_dead_data";
const MALFORMED = "invented-short-key";

describe("a converter's encryption key", () => {
  let dir: string;
  const env = { ...process.env };
  const REPO = process.cwd();
  const journalPath = () =>
    path.join(dir, "drizzle-sqlite", "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    for (const k of Object.keys(hook.converters)) delete hook.converters[k];
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-converter-key-"));
    fs.cpSync(
      path.join(REPO, "drizzle-sqlite"),
      path.join(dir, "drizzle-sqlite"),
      { recursive: true },
    );
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

  /** An install at 0014 (0015 and later pending) holding `secret` in a
   *  `secret_a` setting and an `invented_b` setting. */
  function installBehind(secret: string) {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    journal.entries = journal.entries.slice(
      0,
      journal.entries.findIndex((e) => e.tag === TAG),
    );
    fs.writeFileSync(journalPath(), JSON.stringify(journal));
    runSQLite();
    const db = open();
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('secret_a', ?), ('invented_b', '\"x\"')",
    ).run(JSON.stringify(secret));
    db.close();
    fs.writeFileSync(journalPath(), shipped);
  }
  const settings = () => {
    const db = open();
    const rows = db
      .prepare(
        "SELECT key, value FROM app_settings WHERE key IN ('secret_a', 'invented_b', 'moved_b') ORDER BY key",
      )
      .all() as { key: string; value: string }[];
    const recorded = (
      db.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
        n: number;
      }
    ).n;
    db.close();
    return { rows, recorded };
  };
  const refusal = () => {
    try {
      runSQLite();
    } catch (e) {
      return e;
    }
    return null;
  };

  it("missing: refuses, and the tag's earlier converter rolls back with every pending tag", () => {
    installBehind("invented-password");
    const before = settings();
    delete process.env.ENCRYPTION_KEY;
    hook.converters[TAG] = [renames, encrypts];
    const e = refusal();
    expect(e).toBeInstanceOf(MigrationRefusal);
    expect((e as Error).message).toMatch(
      /^ENCRYPTION_KEY is required to encrypt 1 invented credential\(s\): ENCRYPTION_KEY env var is not set\b.*\. Nothing was changed\. /,
    );
    expect(settings()).toEqual(before);
  });

  it("malformed: refuses without printing it", () => {
    installBehind("invented-password");
    const before = settings();
    process.env.ENCRYPTION_KEY = MALFORMED;
    hook.converters[TAG] = encrypts;
    const e = refusal();
    expect(e).toBeInstanceOf(MigrationRefusal);
    expect((e as Error).message).toContain("must decode to exactly 32 bytes");
    expect((e as Error).message).not.toContain(MALFORMED);
    expect(settings()).toEqual(before);
  });

  it("not asked for: a converter with nothing to encrypt runs without a key", () => {
    installBehind("invented-password");
    const db = open();
    db.exec("DELETE FROM app_settings WHERE key = 'secret_a'");
    db.close();
    delete process.env.ENCRYPTION_KEY;
    hook.converters[TAG] = [renames, encrypts];
    expect(() => runSQLite()).not.toThrow();
    expect(settings().rows).toEqual([{ key: "moved_b", value: '"x"' }]);
  });

  it("set: the converter gets the 32-byte key, and the value decrypts with it", () => {
    installBehind("invented-password");
    const key = randomBytes(32);
    process.env.ENCRYPTION_KEY = key.toString("base64");
    hook.converters[TAG] = encrypts;
    runSQLite();
    const stored = settings().rows.find((r) => r.key === "secret_a")!;
    const envelope: unknown = JSON.parse(stored.value);
    expect(isEncryptedEnvelope(envelope)).toBe(true);
    if (!isEncryptedEnvelope(envelope)) return;
    expect(decryptStringWithKey(key, envelope)).toBe(
      JSON.stringify("invented-password"),
    );
  });

  it("on the restore path too: missing, the restore is refused", () => {
    delete process.env.ENCRYPTION_KEY;
    const tables = {
      app_settings: [{ id: 1, key: "secret_a", value: '"invented"' }],
    };
    expect(() => convertBackup(tables, { [TAG]: encrypts }, TAG)).toThrow(
      MigrationRefusal,
    );
    expect(tables.app_settings[0]!.value).toBe('"invented"');
  });
});
