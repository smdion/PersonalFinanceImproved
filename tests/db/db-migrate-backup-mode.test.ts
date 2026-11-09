/**
 * The migrator's SQLite pre-upgrade backup when it can't be made owner-only
 * (a volume that refuses chmod): the backup stands, a warning is logged, and
 * the upgrade goes on (requireBackupOrAbort lets a written backup through).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../src/lib/db/backup/backup-file", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/lib/db/backup/backup-file")
  >()),
  restrictBackupFile: () => {
    throw new Error("EPERM: operation not permitted, chmod");
  },
}));

const { requireBackupOrAbort, writePreMigrationBackupSqlite } =
  await import("../../db-migrate");

let dir: string;
const env = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-backup-mode-"));
  process.env.LEDGR_BACKUP_DIR = dir;
});
afterEach(() => {
  process.env = { ...env };
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("pre-upgrade backup when chmod fails", () => {
  it("keeps the backup, warns, and lets the migration go on", () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const sqlite = new Database(path.join(dir, "ledgr.db"));
    sqlite.exec(
      "CREATE TABLE people (name TEXT); INSERT INTO people VALUES ('Robin')",
    );

    const backupPath = writePreMigrationBackupSqlite(sqlite);
    sqlite.close();

    expect(backupPath).not.toBeNull();
    expect(fs.existsSync(backupPath!)).toBe(true);
    expect(() => requireBackupOrAbort(backupPath)).not.toThrow();
    const events = logged.mock.calls.map((c) => JSON.parse(String(c[0])).event);
    expect(events).toContain("pre_migration_backup_mode_not_set");
    expect(events).toContain("pre_migration_backup_complete");
  });
});
