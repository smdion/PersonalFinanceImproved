/**
 * Pre-migration backup rules in db-migrate.ts: which migrations are pending
 * (and so what the backup is labelled as), and that a missing backup stops
 * the migration unless explicitly skipped.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  BackupRequiredError,
  pendingJournalEntries,
  prunePreUpgradeBackups,
  requireBackupOrAbort,
} from "../../db-migrate";

const journal = JSON.parse(
  readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
) as { entries: { tag: string }[] };
const hashOf = (tag: string) =>
  createHash("sha256")
    .update(
      readFileSync(path.join(process.cwd(), "drizzle", `${tag}.sql`), "utf8"),
    )
    .digest("hex");

describe("pendingJournalEntries", () => {
  it("lists migrations not yet recorded and labels the backup with the last recorded one", () => {
    const tags = journal.entries.map((e) => e.tag);
    const recorded = new Set(tags.slice(0, -2).map(hashOf));
    expect(
      pendingJournalEntries(journal, "./drizzle", recorded, crypto),
    ).toEqual({ pendingTags: tags.slice(-2), lastAppliedTag: tags.at(-3) });
  });

  it("has nothing pending when every migration is recorded", () => {
    const recorded = new Set(journal.entries.map((e) => hashOf(e.tag)));
    expect(
      pendingJournalEntries(journal, "./drizzle", recorded, crypto).pendingTags,
    ).toEqual([]);
  });
});

describe("requireBackupOrAbort", () => {
  afterEach(() => {
    delete process.env.LEDGR_SKIP_PREMIGRATION_BACKUP;
  });

  it("refuses to migrate without a backup", () => {
    expect(() => requireBackupOrAbort(null)).toThrow(BackupRequiredError);
    expect(() => requireBackupOrAbort(null)).toThrow(/Refusing to migrate/);
  });

  it("proceeds when a backup was written", () => {
    expect(() =>
      requireBackupOrAbort("/data/pre-upgrade-backup.json"),
    ).not.toThrow();
  });

  it("proceeds without a backup only when explicitly told to", () => {
    process.env.LEDGR_SKIP_PREMIGRATION_BACKUP = "true";
    expect(() => requireBackupOrAbort(null)).not.toThrow();
  });
});

describe("prunePreUpgradeBackups", () => {
  it("keeps the newest five backups and leaves other files alone", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ledgr-prune-"));
    for (let i = 1; i <= 7; i++)
      writeFileSync(
        path.join(dir, `pre-upgrade-backup-2026-10-0${i}T00-00-00-000Z.json`),
        "{}",
      );
    writeFileSync(path.join(dir, "ledgr.db"), "");
    writeFileSync(path.join(dir, "my-notes.json"), "{}");
    prunePreUpgradeBackups(dir);
    expect(readdirSync(dir).sort()).toEqual([
      "ledgr.db",
      "my-notes.json",
      "pre-upgrade-backup-2026-10-03T00-00-00-000Z.json",
      "pre-upgrade-backup-2026-10-04T00-00-00-000Z.json",
      "pre-upgrade-backup-2026-10-05T00-00-00-000Z.json",
      "pre-upgrade-backup-2026-10-06T00-00-00-000Z.json",
      "pre-upgrade-backup-2026-10-07T00-00-00-000Z.json",
    ]);
  });
});
