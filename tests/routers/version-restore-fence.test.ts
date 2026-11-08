/**
 * version.restore through the router: a viewer with the version permission
 * restores the household's data and keeps today's connection credentials;
 * an admin's restore brings the version's connections back.
 * A viewer with only the sync permission can't restore. The pre-import
 * data-loss warning names the connections only for an admin.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import {
  createTestCaller,
  adminSession,
  createViewerSessionWithPermissions,
  seedPerson,
  seedPerformanceAccount,
} from "./setup";
import type { Session } from "next-auth";
import * as sqliteSchema from "@/lib/db/schema-sqlite";

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;

const saved = "http://10.0.0.66:5007";
const changed = "https://actual.changed.example";

function connect(db: Ctx["db"], serverUrl: string) {
  db.run(sql`DELETE FROM api_connections`);
  db.insert(sqliteSchema.apiConnections)
    .values({
      service: "actual",
      config: { serverUrl, apiKey: "key", budgetSyncId: "s-1" },
    })
    .run();
}

const serverUrls = (db: Ctx["db"]) =>
  db
    .select()
    .from(sqliteSchema.apiConnections)
    .all()
    .map((r) => (r.config as { serverUrl: string }).serverUrl);

const people = (db: Ctx["db"]) =>
  db
    .select()
    .from(sqliteSchema.people)
    .all()
    .map((p) => p.name);

/** A version taken with `saved` as Actual's URL, then the URL and a name changed. */
async function versionThenEdit(session: Session) {
  const ctx = await createTestCaller(session);
  await seedPerson(ctx.db, "Kept Person", "1990-01-01");
  connect(ctx.db, saved);
  const version = await ctx.caller.version.create({ name: "before edit" });
  connect(ctx.db, changed);
  ctx.db.run(sql`UPDATE people SET name = 'Renamed'`);
  return { ...ctx, versionId: version.id };
}

describe("version.restore and the connections fence", () => {
  it("a viewer with the version permission restores the household and keeps today's connection", async () => {
    const { caller, db, cleanup, versionId } = await versionThenEdit(
      createViewerSessionWithPermissions(["version"]),
    );
    try {
      await caller.version.restore({ id: versionId });
      expect(serverUrls(db)).toEqual([changed]);
      expect(people(db)).toEqual(["Kept Person"]);
    } finally {
      cleanup();
    }
  });

  it("an admin's restore brings the version's connection back", async () => {
    const { caller, db, cleanup, versionId } =
      await versionThenEdit(adminSession);
    try {
      await caller.version.restore({ id: versionId });
      expect(serverUrls(db)).toEqual([saved]);
      expect(people(db)).toEqual(["Kept Person"]);
    } finally {
      cleanup();
    }
  });

  it("a viewer with only the sync permission can't restore", async () => {
    const { caller, cleanup } = await createTestCaller(
      createViewerSessionWithPermissions(["sync"]),
    );
    try {
      await expect(caller.version.restore({ id: 1 })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      cleanup();
    }
  });

  it.each([
    ["a version viewer", createViewerSessionWithPermissions(["version"]), []],
    ["an admin", adminSession, ["api_connections"]],
  ] as const)(
    "importDataLoss names the connections a backup lacks only for an admin (%s)",
    async (_who, session, named) => {
      const { caller, db, cleanup } = await createTestCaller(session);
      try {
        connect(db, saved);
        const lost = await caller.version.importDataLoss({ tableNames: [] });
        const connections = lost.filter(
          (t) => t.tableName === "api_connections",
        );
        expect(connections.map((t) => t.tableName)).toEqual(named);
      } finally {
        cleanup();
      }
    },
  );
});

describe("version.restore over a value Ledgr doesn't have", () => {
  /** A version whose performance account holds `accountType`. */
  async function versionWith(accountType: string) {
    const ctx = await createTestCaller(adminSession);
    seedPerformanceAccount(ctx.db, { accountLabel: "Robin 401k" });
    const version = await ctx.caller.version.create({ name: "odd type" });
    const entry = ctx.db
      .select()
      .from(sqliteSchema.stateVersionTables)
      .all()
      .find(
        (t) =>
          t.versionId === version.id && t.tableName === "performance_accounts",
      )!;
    const rows = (entry.data as Record<string, unknown>[]).map((r) => ({
      ...r,
      account_type: accountType,
    }));
    ctx.db.run(
      sql`UPDATE state_version_tables SET data = ${JSON.stringify(rows)} WHERE id = ${entry.id}`,
    );
    ctx.db.run(sql`UPDATE performance_accounts SET account_label = 'Today'`);
    return { ...ctx, versionId: version.id };
  }

  it("refuses with a BAD_REQUEST naming the value, and keeps today's data", async () => {
    const ctx = await versionWith("solo401k");
    try {
      await expect(
        ctx.caller.version.restore({ id: ctx.versionId }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(
          /performance_accounts\.account_type = "solo401k" \(1 row\).*Restore another version/,
        ),
      });
      expect(
        ctx.db
          .select()
          .from(sqliteSchema.performanceAccounts)
          .all()
          .map((a) => [a.accountLabel, a.accountType]),
      ).toEqual([["Today", "401k"]]);
    } finally {
      ctx.cleanup();
    }
  });

  it("restores a valid version with no notes", async () => {
    const ctx = await versionWith("ira");
    try {
      const restored = await ctx.caller.version.restore({ id: ctx.versionId });
      expect(restored.valueNotes).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});
