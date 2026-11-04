/**
 * Behavior baseline, part c, on PostgreSQL: the same households, calls and
 * files as router-baseline.test.ts (read its header for the baseline
 * rule). Each household is seeded into a database migrated from empty by
 * the real migrator. The two databases must give the same numbers; a path
 * where PostgreSQL is known to differ is listed in KNOWN_GAPS, each one a
 * v0.11 bug.
 *
 * Runs only when TEST_DATABASE_URL names a throwaway database (ending in
 * `_test`): it drops and rebuilds the schemas for every household. CI runs
 * it in the PostgreSQL job. The files are only ever written from SQLite.
 */
// First: the PostgreSQL harness's mocks, then the baseline's.
import {
  closeAppPool,
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "../routers/setup-postgres";
import "./mocks";
import { describe, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { Session } from "next-auth";
import { runMigrator } from "../routers/fresh-install-cases";
import type { Caller } from "./seed";
import { defineRouterBaseline } from "./router-suite";
import { HOUSEHOLDS } from "./households";

/** `<household>/<procedure>` → paths PostgreSQL gets differently. */
const KNOWN_GAPS: Record<string, string[]> = {
  // v0.11: these queries have no full ORDER BY, so PostgreSQL returns the
  // same rows in another order (first CI run, 2026-11-03): tax-bracket
  // sets, a snapshot's per-account totals, budget items, contribution
  // accounts. Same numbers; the lists would show in another order.
  "*/settings.taxBrackets.list": ["unordered"],
  "*/networth.listSnapshotTotals": ["unordered"],
  "*/budget.computeActiveSummary": ["unordered"],
  "*/settings.contributionAccounts.list": ["unordered"],
};

// Not imported from ../routers/setup: that module loads the db module (as
// SQLite) before this file can point DATABASE_URL at PostgreSQL.
const adminSession: Session = {
  user: {
    id: "test-admin",
    name: "Test Admin",
    email: "admin@test.local",
    role: "admin",
    permissions: [],
  },
  expires: "2099-12-31T23:59:59.999Z",
};

describe.skipIf(skipWithoutPostgres)("router baseline on PostgreSQL", () => {
  let restoreEnv: () => void = () => {};
  let admin: pg.Client;

  beforeAll(async () => {
    const testDatabase = pointAtTestDatabase("baseline-pg");
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

  defineRouterBaseline({
    dialect: "postgres",
    households: HOUSEHOLDS,
    wholeBaselineChecks: true,
    knownGaps: KNOWN_GAPS,
    timeout: 300_000,
    open: async () => {
      await dropAllSchemas(admin);
      runMigrator();
      const { appRouter } = await import("@/server/routers");
      const { createCallerFactory } = await import("@/server/trpc");
      const { db } = await import("@/lib/db");
      const { invalidateYearEndCache } = await import("@/server/helpers");
      // The pool outlives each household: drop what was read from the last.
      invalidateYearEndCache();
      const caller: Caller = createCallerFactory(appRouter)({
        db,
        session: adminSession,
        demoSchema: null,
      });
      return { caller, close: () => {} };
    },
  });
});
