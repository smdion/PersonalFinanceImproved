/**
 * version.restore through the router: a viewer with the version permission
 * restores the household's data and leaves the installation's connections
 * as they are; an admin's restore brings the version's connections back.
 * A viewer with only the sync permission can't restore.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import {
  createTestCaller,
  adminSession,
  createViewerSessionWithPermissions,
  seedPerson,
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
});
