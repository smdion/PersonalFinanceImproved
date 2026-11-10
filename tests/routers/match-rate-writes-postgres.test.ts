/**
 * The match writes on PostgreSQL (advisor E9 M15; the cases are in
 * ./match-rate-writes-cases, shared with SQLite): numeric columns come back
 * at their scale ("50.00", "0.500000") and the profile column is jsonb, so a
 * writer or refreshEntryRates that only works on SQLite fails here by name.
 *
 * Runs only when TEST_DATABASE_URL names a throwaway database (its name
 * must end in `_test`): the test drops and rebuilds its schemas. CI runs it
 * in the PostgreSQL job.
 */
// First: its mocks must be in place before any app module loads.
import {
  closeAppPool,
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "./setup-postgres";
import { describe, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import type { Session } from "next-auth";
import { runMigrator } from "./fresh-install-cases";
import {
  matchRateWriteCases,
  type MatchRateDb,
} from "./match-rate-writes-cases";

// Not imported from ./setup: that module loads the db module (as SQLite)
// before this file can point DATABASE_URL at PostgreSQL.
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

const COLUMNS = {
  employerMatchValue: "employer_match_value",
  employerMatchRate: "employer_match_rate",
} as const;

describe.skipIf(skipWithoutPostgres)("match writes (PostgreSQL)", () => {
  let restoreEnv: () => void = () => {};
  let admin: pg.Client;
  let h: MatchRateDb;
  let newJob: () => Promise<number>;

  beforeAll(async () => {
    const testDatabase = pointAtTestDatabase("match-writes-pg");
    restoreEnv = testDatabase.restore;
    delete process.env.DEMO_ONLY;
    admin = new pg.Client({ connectionString: testDatabase.url });
    await admin.connect();
    await dropAllSchemas(admin);
    runMigrator();

    // Imported only after DATABASE_URL points at the test database: the db
    // module picks its dialect when it's first imported.
    const { appRouter } = await import("@/server/routers");
    const { createCallerFactory } = await import("@/server/trpc");
    const { db } = await import("@/lib/db");
    const caller = createCallerFactory(appRouter)({
      db,
      session: adminSession,
      demoSchema: null,
    });
    const one = async (sql: string, params: unknown[] = []) =>
      (await admin.query<Record<string, unknown>>(sql, params)).rows[0]!;
    const person = await one(
      "INSERT INTO people (name, date_of_birth) VALUES ('Invented Saver', '1985-03-01') RETURNING id",
    );
    newJob = async () => {
      const job = await one(
        "INSERT INTO jobs (person_id, employer_name, start_date) VALUES ($1, 'TestCo', '2020-01-01') RETURNING id",
        [person["id"]],
      );
      return Number(job["id"]);
    };
    h = {
      caller,
      personId: Number(person["id"]),
      jobId: 0,
      row: async (id) => {
        const r = (await caller.settings.contributionAccounts.list()).find(
          (x) => x.id === id,
        )!;
        return {
          ...r,
          employerMatchValue: r.employerMatchValue,
          employerMatchRate: r.employerMatchRate,
        };
      },
      entries: async (id) => {
        const r = await one(
          "SELECT contribution_active_fields AS f FROM contribution_profiles WHERE id = $1",
          [id],
        );
        const fields = r["f"] as {
          contributionAccounts: Record<string, Record<string, unknown>>;
        };
        return fields.contributionAccounts;
      },
      setAccount: async (id, set) => {
        for (const [key, value] of Object.entries(set))
          await admin.query(
            `UPDATE contribution_accounts SET ${COLUMNS[key as keyof typeof COLUMNS]} = $2 WHERE id = $1`,
            [id, value],
          );
      },
      setFields: async (id, fields) => {
        await admin.query(
          "UPDATE contribution_profiles SET contribution_active_fields = $2::jsonb WHERE id = $1",
          [id, JSON.stringify(fields)],
        );
      },
    };
  }, 300_000);

  // One database for every case (SQLite gets a fresh one per case): each
  // gets its own job, as the one-match-account-per-job index needs, and the
  // cases' profile name is unique, so the last case's profile goes first.
  beforeEach(async () => {
    await admin.query(
      "DELETE FROM contribution_profiles WHERE name = 'Invented plan'",
    );
    h = { ...h, jobId: await newJob() };
  });

  afterAll(async () => {
    await admin?.end();
    await closeAppPool();
    restoreEnv();
  });

  matchRateWriteCases(() => h);
});
