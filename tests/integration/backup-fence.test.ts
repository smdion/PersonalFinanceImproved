/**
 * The connections fence and the closed-set check on SQLite (the cases are in
 * ./backup-fence-cases and ./closed-set-import-cases, shared with
 * PostgreSQL): each case runs on a fresh migrated database.
 */
import "../routers/setup-mocks";
import { describe, it, expect } from "vitest";
import { createTestCaller } from "../routers/setup";
import { backupFenceCases } from "./backup-fence-cases";
import {
  closedSetImportCases,
  unknownAccountTypeCases,
} from "./closed-set-import-cases";

async function fresh() {
  const { rawDb, sqlite, cleanup } = await createTestCaller();
  const columns = async (table: string) =>
    sqlite
      .prepare(`PRAGMA table_info("${table}")`)
      .all()
      .map((c) => (c as { name: string }).name);
  return { db: rawDb, columns, done: cleanup };
}

describe("backup connections fence (SQLite)", () => {
  backupFenceCases(fresh);
});

describe("closed-set values on import and restore (SQLite)", () => {
  closedSetImportCases(fresh);
  unknownAccountTypeCases(fresh);
});

describe("an installation table with no column lists", () => {
  it("stops a non-admin's import rather than keeping it whole", async () => {
    const { INSTALLATION_COLUMNS } =
      await import("@/lib/db/backup/installation-rows");
    const { exportBackup, importBackup } =
      await import("@/lib/db/backup/version-logic");
    const { rawDb, cleanup } = await createTestCaller();
    const listed = INSTALLATION_COLUMNS["api_connections"];
    delete INSTALLATION_COLUMNS["api_connections"];
    try {
      const backup = await exportBackup(rawDb);
      await expect(
        importBackup(rawDb, backup, { asAdmin: false }),
      ).rejects.toThrow("api_connections: no installation columns listed");
    } finally {
      INSTALLATION_COLUMNS["api_connections"] = listed!;
      cleanup();
    }
  });
});
