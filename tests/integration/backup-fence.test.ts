/**
 * The connections fence on SQLite (the cases are in ./backup-fence-cases,
 * shared with PostgreSQL): each case runs on a fresh migrated database.
 */
import "../routers/setup-mocks";
import { describe } from "vitest";
import { createTestCaller } from "../routers/setup";
import { backupFenceCases } from "./backup-fence-cases";

describe("backup connections fence (SQLite)", () => {
  backupFenceCases(async () => {
    const { rawDb, cleanup } = await createTestCaller();
    return { db: rawDb, done: cleanup };
  });
});
