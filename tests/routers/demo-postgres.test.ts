/**
 * Demo profiles on PostgreSQL, end to end: the real migrator, a demo profile
 * set up through `demo.activateProfile`, then data calls through the real
 * procedure middleware with that demo active. Demo schemas exist only on
 * PostgreSQL, so the SQLite suite never reaches this path.
 *
 * Runs only when TEST_DATABASE_URL names a throwaway database (its name
 * must end in `_test`): the test drops and rebuilds its public schema. CI
 * runs it against a PostgreSQL service with DEMO_ONLY on, as the public
 * demo runs, and its "with a demo active" case again with DEMO_ONLY off,
 * as a household install runs a demo.
 */
// First: its mocks must be in place before any app module loads.
import {
  closeAppPool,
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "./setup-postgres";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { cookies } from "next/headers";
import pg from "pg";
import type { Session } from "next-auth";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import type { ReadMemo } from "@/server/data/request-scope";
import { runMigrator } from "./fresh-install-cases";

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

describe.skipIf(skipWithoutPostgres)("demo profiles on PostgreSQL", () => {
  let restoreEnv: () => void = () => {};
  let admin: pg.Client;
  let schemaName: string;

  /** A caller with `demoSchema` active. Imported only after DATABASE_URL
   *  points at the test database: the db module picks its dialect when it's
   *  first imported. */
  async function callerFor(demoSchema: string | null, reads?: ReadMemo) {
    const { appRouter } = await import("@/server/routers");
    const { createCallerFactory } = await import("@/server/trpc");
    const { db } = await import("@/lib/db");
    return createCallerFactory(appRouter)({
      db,
      session: adminSession,
      demoSchema,
      reads,
    });
  }

  beforeAll(async () => {
    const testDatabase = pointAtTestDatabase("demo-pg");
    restoreEnv = testDatabase.restore;
    admin = new pg.Client({ connectionString: testDatabase.url });
    await admin.connect();
    await dropAllSchemas(admin);

    runMigrator();

    // activateProfile sets the demo cookie; only `set` is called.
    // eslint-disable-next-line no-restricted-syntax -- a partial cookie store stands in for Next's request-scoped one
    vi.mocked(cookies).mockResolvedValue({ set: vi.fn() } as unknown as Awaited<
      ReturnType<typeof cookies>
    >);

    const caller = await callerFor(null);
    const { profiles } = await caller.demo.listProfiles();
    const activated = await caller.demo.activateProfile({
      slug: profiles[0]!.slug,
    });
    schemaName = activated.schemaName;
  }, 300_000);

  afterAll(async () => {
    await admin?.end();
    await closeAppPool();
    restoreEnv();
  });

  it("serves data calls with a demo profile active", async () => {
    const people = await (await callerFor(schemaName)).settings.people.list();
    expect(people.length).toBeGreaterThan(0);
  });

  it("reads the demo household, not the install's", async () => {
    const { rows } = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.people",
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("shares install-wide tables with public instead of copying them", async () => {
    const { DEMO_SHARED_TABLES } =
      await import("@/lib/db/migrate/demo-schema-marker");
    const { rows } = await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename = ANY($2::text[])",
      [schemaName, DEMO_SHARED_TABLES],
    );
    expect(rows).toEqual([]);
  });

  it("each profile's chooser savings rate is the Contribution page's rate", async () => {
    // Seeded exactly as a visitor's demo is, then computed as the page
    // computes it (computeSummary → householdSavings): projected, match
    // included, Portfolio money counted — the glossary's savings rate.
    const { DEMO_PROFILES } = await import("@/lib/demo");
    const { householdSavings } =
      await import("@/lib/pure/contributions/savings-rate");
    for (const profile of Object.values(DEMO_PROFILES)) {
      const { schemaName: demo } = await (
        await callerFor(null)
      ).demo.activateProfile({ slug: profile.slug });
      if (profile.keyStats.savingsRate === "N/A") {
        const summary = await (
          await callerFor(demo)
        ).contribution.computeSummary();
        expect(
          summary.people.filter((p) => p.salary > 0),
          profile.slug,
        ).toEqual([]);
        continue;
      }
      // The page asks for the active Contribution Profile by id; with no
      // profile nothing resolves (every contribution reads $0).
      const { rows: active } = await admin.query<{ value: unknown }>(
        `SELECT value FROM "${demo}".app_settings WHERE key = $1`,
        [SK_ACTIVE_CONTRIB_PROFILE_ID],
      );
      const contributionProfileId = Number(active[0]?.value);
      expect(Number.isInteger(contributionProfileId), profile.slug).toBe(true);
      const summary = await (
        await callerFor(demo)
      ).contribution.computeSummary({ contributionProfileId });
      const earners = summary.people.filter((p) => p.salary > 0);
      const { rate } = householdSavings(
        earners,
        summary.jointAccountTypes,
        "projected",
        { excludeMatch: false },
      );
      // Soft: one run reports every profile that disagrees.
      expect
        .soft(`${Math.round(rate * 100)}%`, profile.slug)
        .toBe(profile.keyStats.savingsRate);
    }
  }, 300_000);

  it("each profile's demo schema fills every data table but the listed empty ones", async () => {
    // The SQLite guard (tests/demo/demo-completeness.test.ts) on the real
    // demo path, for the tables: the same list and the same empty cases.
    const { DEMO_PROFILES } = await import("@/lib/demo");
    const { DEMO_DATA_TABLES, expectedEmptyTables } =
      await import("../demo/demo-tables");
    for (const profile of Object.values(DEMO_PROFILES)) {
      const { schemaName: demo } = await (
        await callerFor(null)
      ).demo.activateProfile({ slug: profile.slug });
      const empty: string[] = [];
      for (const table of DEMO_DATA_TABLES) {
        const { rows } = await admin.query<{ filled: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM "${demo}"."${table}") AS filled`,
        );
        if (!rows[0]!.filled) empty.push(table);
      }
      expect
        .soft(empty.sort(), profile.slug)
        .toEqual(expectedEmptyTables(profile.slug, DEMO_DATA_TABLES));
    }
  }, 300_000);

  // A household install with a demo active (DEMO_ONLY off): the live pool's
  // reads and the write go to the demo schema. The public schema has no
  // budget profile or pay, so a public read would fail the call.
  it.skipIf(process.env.DEMO_ONLY === "true")(
    "savings.recalculateAllocation with a demo active reads and writes the demo schema",
    async () => {
      // A profile with pay, so its live pool is positive.
      const { schemaName: demo } = await (
        await callerFor(null)
      ).demo.activateProfile({ slug: "single-income" });
      const { rows: target } = await admin.query<{
        goal: number;
        profile: number;
      }>(
        `SELECT (SELECT min(id) FROM "${demo}".savings_goals WHERE is_active) AS goal,
                (SELECT min(id) FROM "${demo}".budget_profiles WHERE is_active) AS profile`,
      );
      const { goal, profile } = target[0]!;
      expect(goal).not.toBeNull();
      expect(profile).not.toBeNull();
      await admin.query(
        `DELETE FROM "${demo}".savings_goal_profile_allocations WHERE goal_id = $1 AND budget_profile_id = $2`,
        [goal, profile],
      );
      await admin.query(
        `INSERT INTO "${demo}".savings_goal_profile_allocations (goal_id, budget_profile_id, allocation_percent, monthly_contribution) VALUES ($1, $2, '10.000', '0.00')`,
        [goal, profile],
      );

      const result = await (
        await callerFor(demo)
      ).savings.recalculateAllocation({ goalId: goal });

      expect(result).toEqual({ updated: 1 });
      const { rows: written } = await admin.query<{ amount: string }>(
        `SELECT monthly_contribution AS amount FROM "${demo}".savings_goal_profile_allocations WHERE goal_id = $1 AND budget_profile_id = $2`,
        [goal, profile],
      );
      expect(Number(written[0]!.amount)).toBeGreaterThan(0);
      const { rows: publicRows } = await admin.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.savings_goal_profile_allocations",
      );
      expect(publicRows[0]!.n).toBe(0);
    },
  );

  it.runIf(process.env.DEMO_ONLY === "true")(
    "savings.recalculateAllocation is refused on the public demo",
    async () => {
      await expect(
        (await callerFor(schemaName)).savings.recalculateAllocation(),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it("never serves a demo call a public read, or the reverse, under one memo", async () => {
    const { createReadMemo } = await import("@/server/data/request-scope");
    const reads = createReadMemo({ freeze: true });
    const demo = await callerFor(schemaName, reads);
    const install = await callerFor(null, reads);
    const names = (s: { people: { person: { name: string } }[] }) =>
      s.people.map((p) => p.person.name);
    // A demo-only server refuses a request with no demo profile chosen.
    const demoOnly = process.env.DEMO_ONLY === "true";
    const publicNames = () =>
      install.paycheck.computeSummary().then(names, (e: unknown) => {
        if (demoOnly) return "refused";
        throw e;
      });
    const [publicFirst, demoSummary, contribution, publicAfter] =
      await Promise.all([
        publicNames(),
        demo.paycheck.computeSummary(),
        demo.contribution.computeSummary(),
        publicNames(),
      ]);
    expect(publicFirst).toEqual(demoOnly ? "refused" : []);
    expect(publicAfter).toEqual(demoOnly ? "refused" : []);
    const { rows } = await admin.query<{ name: string }>(
      `SELECT name FROM "${schemaName}".people ORDER BY id`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(names(demoSummary)).toEqual(rows.map((r) => r.name));
    expect(contribution.people.length).toBe(rows.length);
  });

  it("two builds of one demo profile at once seed it once", async () => {
    const { buildDemoSchema } =
      await import("@/server/services/demo/demo-schema");
    const { getDemoProfile, isDemoProfileSlug } = await import("@/lib/demo");
    const { profiles } = await (await callerFor(null)).demo.listProfiles();
    const slug = profiles[0]!.slug;
    if (!isDemoProfileSlug(slug)) throw new Error(`Not a profile: ${slug}`);
    await Promise.all([
      buildDemoSchema(slug, new Date("2026-06-01T12:00:00Z")),
      buildDemoSchema(slug, new Date("2026-06-01T12:00:00Z")),
    ]);
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${schemaName}".people`,
    );
    expect(rows[0]!.n).toBe(getDemoProfile(slug)!.people.length);
    const people = await (await callerFor(schemaName)).settings.people.list();
    expect(people).toHaveLength(rows[0]!.n);
  });

  it("refuses a demo schema missing one of its own tables", async () => {
    await admin.query(`DROP TABLE "${schemaName}".people CASCADE`);
    await expect(
      (await callerFor(schemaName)).settings.people.list(),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
