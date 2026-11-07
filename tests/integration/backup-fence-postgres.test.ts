/**
 * The connections fence and the closed-set check on PostgreSQL (the cases
 * are in ./backup-fence-cases and ./closed-set-import-cases, shared with
 * SQLite): ids are reused after a restore resets the sequences, and
 * TRUNCATE ... CASCADE runs over the other tables.
 *
 * Runs only when TEST_DATABASE_URL names a throwaway database (its name
 * must end in `_test`): each case drops and rebuilds its schemas. CI runs
 * it in the PostgreSQL job.
 */
// First: its mocks must be in place before any app module loads.
import {
  closeAppPool,
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "../routers/setup-postgres";
import { describe, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { runMigrator } from "../routers/fresh-install-cases";
import { backupFenceCases } from "./backup-fence-cases";
import { closedSetImportCases } from "./closed-set-import-cases";

describe.skipIf(skipWithoutPostgres)(
  "backup connections fence (PostgreSQL)",
  () => {
    let restoreEnv: () => void = () => {};
    let admin: pg.Client;

    beforeAll(async () => {
      const testDatabase = pointAtTestDatabase("backup-fence-pg");
      restoreEnv = testDatabase.restore;
      delete process.env.DEMO_ONLY;
      admin = new pg.Client({ connectionString: testDatabase.url });
      await admin.connect();
    });

    afterAll(async () => {
      await admin?.end();
      await closeAppPool();
      restoreEnv();
    });

    const fresh = async () => {
      await dropAllSchemas(admin);
      runMigrator();
      // Imported only after DATABASE_URL points at the test database: the db
      // module picks its dialect when it's first imported.
      const { db } = await import("@/lib/db");
      const columns = async (table: string) =>
        (
          await admin.query<{ column_name: string }>(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
            [table],
          )
        ).rows.map((r) => r.column_name);
      return { db: db as never, columns, done: () => {} };
    };

    backupFenceCases(fresh);
    closedSetImportCases(fresh);
  },
);
