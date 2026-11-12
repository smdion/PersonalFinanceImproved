/**
 * Read-merge-writes hold their row's lock on PostgreSQL: overlapping saves
 * to one Salary Profile or one budget profile each land, none lost, a
 * transaction waiting on a held row lock reads the holder's committed write,
 * and a job delete racing a Salary Profile write leaves no entry for it.
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
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { Session } from "next-auth";
import { eq } from "drizzle-orm";
import type { AppRouter } from "@/server/routers";
import { BLANK_SALARY_ENTRY } from "@/lib/db/shapes/salary-entry-defaults";
import { runMigrator } from "./fresh-install-cases";

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

const OVERLAPPING = 8;

describe.skipIf(skipWithoutPostgres)("row locks (PostgreSQL)", () => {
  let restoreEnv: () => void = () => {};
  let admin: pg.Client;
  let app: {
    db: typeof import("@/lib/db").db;
    schema: typeof import("@/lib/db/schema");
    lockedRow: typeof import("@/server/data/lock-row").lockedRow;
    caller: ReturnType<AppRouter["createCaller"]>;
  };
  const one = async (sql: string, params: unknown[] = []) =>
    (await admin.query<Record<string, unknown>>(sql, params)).rows[0]!;

  beforeAll(async () => {
    const testDatabase = pointAtTestDatabase("row-locks-pg");
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
    app = {
      db,
      schema: await import("@/lib/db/schema"),
      lockedRow: (await import("@/server/data/lock-row")).lockedRow,
      caller: createCallerFactory(appRouter)({
        db,
        session: adminSession,
        demoSchema: null,
      }),
    };
  });
  afterAll(async () => {
    await closeAppPool();
    if (admin) {
      await dropAllSchemas(admin);
      await admin.end();
    }
    restoreEnv();
  });

  it("a transaction waiting on a held row lock reads the holder's committed write", async () => {
    const { db, schema, lockedRow } = app;
    const { id } = await one(
      "INSERT INTO salary_profiles (name, salaries) VALUES ('Invented locks', '{}'::jsonb) RETURNING id",
    );
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));
    const first = db.transaction(async (tx) => {
      await lockedRow(tx, schema.salaryProfiles, Number(id));
      locked();
      await held;
      await tx
        .update(schema.salaryProfiles)
        .set({ salaries: { held: true } as never })
        .where(eq(schema.salaryProfiles.id, Number(id)));
    });
    await holding;
    const second = db.transaction(
      async (tx) =>
        (await lockedRow(tx, schema.salaryProfiles, Number(id)))?.salaries,
    );
    setTimeout(release, 50);
    await first;
    expect(await second).toEqual({ held: true });
  });

  it.each([
    ["a new profile", false],
    ["an existing profile it holds locked", true],
  ])(
    "a job delete racing a Salary Profile write (%s) neither deadlocks nor leaves an entry for the gone job",
    async (_, existing) => {
      const { db, schema, lockedRow } = app;
      const { refuseEntriesWithoutJobs } =
        await import("@/server/services/profiles/salary-entry-writes");
      const { deleteJobsAndEntries } =
        await import("@/server/data/delete-jobs");
      const { id: personId } = await one(
        "INSERT INTO people (name, date_of_birth) VALUES ('Invented Racer', '1980-01-01') RETURNING id",
      );
      const { id: jobId } = await one(
        "INSERT INTO jobs (person_id, employer_name, start_date) VALUES ($1, 'Invented Co', '2020-01-01') RETURNING id",
        [personId],
      );
      const key = String(jobId);
      const name = `Invented raced ${String(existing)}`;
      const { id: profileId } = await one(
        "INSERT INTO salary_profiles (name, salaries) VALUES ($1, '{}'::jsonb) RETURNING id",
        [existing ? name : `${name} (other)`],
      );
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const locking = new Promise<void>((r) => (locked = r));
      // The writers' order: the job's key-share lock, then the profile's lock.
      const writer = db.transaction(async (tx) => {
        await refuseEntriesWithoutJobs(tx, [key]);
        if (existing)
          await lockedRow(tx, schema.salaryProfiles, Number(profileId));
        locked();
        await held;
        const salaries = { [key]: BLANK_SALARY_ENTRY } as never;
        if (existing)
          await tx
            .update(schema.salaryProfiles)
            .set({ salaries })
            .where(eq(schema.salaryProfiles.id, Number(profileId)));
        else await tx.insert(schema.salaryProfiles).values({ name, salaries });
      });
      await locking;
      const deleting = deleteJobsAndEntries(db, [Number(jobId)]);
      setTimeout(release, 50);
      await Promise.all([writer, deleting]);
      const after = await one(
        "SELECT salaries FROM salary_profiles WHERE name = $1",
        [name],
      );
      expect(after["salaries"]).toEqual({});
    },
  );

  it("overlapping entry removals on one Salary Profile each land", async () => {
    const salaries = Object.fromEntries(
      Array.from({ length: OVERLAPPING }, (_, i) => [
        String(1000 + i),
        BLANK_SALARY_ENTRY,
      ]),
    );
    const { id } = await one(
      "INSERT INTO salary_profiles (name, salaries) VALUES ('Invented overlap', $1::jsonb) RETURNING id",
      [JSON.stringify(salaries)],
    );
    await Promise.all(
      Object.keys(salaries).map((jobId) =>
        app.caller.salaryProfile.removeEntry({
          id: Number(id),
          jobId: Number(jobId),
        }),
      ),
    );
    const after = await one(
      "SELECT salaries FROM salary_profiles WHERE id = $1",
      [id],
    );
    expect(after["salaries"]).toEqual({});
  });

  it("overlapping column adds on one budget profile each land on the profile and every item", async () => {
    const profile = await app.caller.budget.createProfile({
      name: "Invented columns",
    });
    await Promise.all(
      Array.from({ length: OVERLAPPING }, (_, i) =>
        app.caller.budget.addColumn({
          label: `Column ${i}`,
          profileId: profile.id,
        }),
      ),
    );
    const labels = await one(
      "SELECT column_labels FROM budget_profiles WHERE id = $1",
      [profile.id],
    );
    expect(labels["column_labels"]).toHaveLength(OVERLAPPING + 1);
    const lengths = await admin.query<{ n: number }>(
      "SELECT DISTINCT jsonb_array_length(amounts) AS n FROM budget_items WHERE profile_id = $1",
      [profile.id],
    );
    expect(lengths.rows).toEqual([{ n: OVERLAPPING + 1 }]);
  });
});
