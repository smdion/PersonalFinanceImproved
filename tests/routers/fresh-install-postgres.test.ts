/**
 * A fresh install on PostgreSQL: each case drops the database's schemas,
 * runs the real migrator, then goes through the app's procedures as a first
 * run does (the cases are in ./fresh-install-cases, shared with SQLite).
 *
 * Runs only when TEST_DATABASE_URL names a throwaway database (its name
 * must end in `_test`): the test drops and rebuilds its public schema. CI
 * runs it against a PostgreSQL service with DEMO_ONLY unset, as a
 * self-hosted install runs.
 */
// First: its mocks must be in place before any app module loads.
import {
  closeAppPool,
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "./setup-postgres";
import { describe, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { freshInstallCases, runMigrator } from "./fresh-install-cases";

describe.skipIf(skipWithoutPostgres)("fresh install (PostgreSQL)", () => {
  let restoreEnv: () => void = () => {};
  let admin: pg.Client;

  beforeAll(async () => {
    const testDatabase = pointAtTestDatabase("fresh-pg");
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

  freshInstallCases(async () => {
    await dropAllSchemas(admin);
    runMigrator();

    // Imported only after DATABASE_URL points at the test database: the db
    // module picks its dialect when it's first imported.
    const { appRouter } = await import("@/server/routers");
    const { createCallerFactory } = await import("@/server/trpc");
    const { db } = await import("@/lib/db");
    const callerFactory = createCallerFactory(appRouter);
    return {
      caller: (session) => callerFactory({ db, session, demoSchema: null }),
      count: async (table) => {
        const result = await admin.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public."${table}"`,
        );
        return result.rows[0]!.n;
      },
    };
  });
});
