/**
 * The connections fence on a backup import or version restore, shared by the
 * SQLite and PostgreSQL files: someone who isn't an admin keeps today's
 * credentials and sync state and takes the backup's links (mappings, skipped
 * categories, linked profile and column) with the backup's rows; an admin
 * takes the backup's connections whole. Each file supplies `fresh()`.
 *
 * Imports only types from the app: the PostgreSQL file must point
 * DATABASE_URL at its database before the db module is first imported.
 */
import { it, expect } from "vitest";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as Schema from "@/lib/db/schema";

type Db = NodePgDatabase<typeof Schema>;

export interface FenceDb {
  db: Db;
  done: () => Promise<void> | void;
}

const notAdmin = { asAdmin: false };
const admin = { asAdmin: true };

async function app() {
  const schema = await import("@/lib/db/schema");
  const versions = await import("@/lib/db/version-logic");
  return { schema, ...versions };
}

/** An invented asset, budget profile and connection set for one household. */
async function household(db: Db, label: string, services: string[]) {
  const { schema } = await app();
  const [asset] = await db
    .insert(schema.otherAssetItems)
    .values({ name: `${label} asset`, year: 2026, value: "1000.00" })
    .returning();
  const [profile] = await db
    .insert(schema.budgetProfiles)
    .values({ name: `${label} budget`, columnLabels: ["Standard"] })
    .returning();
  for (const service of services)
    await db.insert(schema.apiConnections).values({
      service,
      config: { accessToken: `${label}-token`, budgetId: "b-1" },
      accountMappings: [
        {
          localName: `${label} asset`,
          remoteAccountId: `${label}-remote`,
          syncDirection: "pull",
          assetId: asset!.id,
        },
      ],
      skippedCategoryIds: [`${label}-category`],
      linkedProfileId: profile!.id,
      linkedColumnIndex: 0,
      serverKnowledge: label.length,
    });
  return { assetId: asset!.id, profileId: profile!.id };
}

async function connections(db: Db) {
  const { schema } = await app();
  const rows = await db.select().from(schema.apiConnections);
  return rows.sort((a, b) => a.service.localeCompare(b.service));
}

/** Every mapped asset and linked profile names a row that exists, by label. */
async function linkTargets(db: Db) {
  const { schema } = await app();
  const assets = await db.select().from(schema.otherAssetItems);
  const profiles = await db.select().from(schema.budgetProfiles);
  return (await connections(db)).map((c) => ({
    service: c.service,
    assets: (c.accountMappings ?? []).map(
      (m) => assets.find((a) => a.id === m.assetId)?.name ?? "missing",
    ),
    profile:
      c.linkedProfileId == null
        ? null
        : (profiles.find((p) => p.id === c.linkedProfileId)?.name ?? "missing"),
  }));
}

export function backupFenceCases(fresh: () => Promise<FenceDb>) {
  it("a non-admin restore keeps today's credentials and takes the version's links, so a reused id isn't mapped", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, createVersion, restoreVersion } = await app();
      await household(db, "Kept", ["ynab"]);
      const version = await createVersion(db, {
        name: "before",
        type: "manual",
        createdBy: "test",
      });
      const atVersion = await linkTargets(db);

      // After the version: a new asset, mapped, and new credentials.
      const later = await household(db, "Later", []);
      const [ynab] = await connections(db);
      await db
        .update(schema.apiConnections)
        .set({
          config: { accessToken: "today-token", budgetId: "b-1" },
          accountMappings: [
            ...(ynab!.accountMappings ?? []),
            {
              localName: "Later asset",
              remoteAccountId: "later-remote",
              syncDirection: "pull",
              assetId: later.assetId,
            },
          ],
        })
        .where(eq(schema.apiConnections.service, "ynab"));

      const fenced = await restoreVersion(db, version.id, notAdmin);
      const [after] = await connections(db);
      expect(after!.config).toEqual({
        accessToken: "today-token",
        budgetId: "b-1",
      });
      expect(await linkTargets(db)).toEqual(atVersion);

      // An asset created now may take the later asset's old id: unmapped.
      const next = await household(db, "Next", []);
      expect(
        (after!.accountMappings ?? []).map((m) => m.assetId),
      ).not.toContain(next.assetId);

      // Its count leaves out the table it didn't take from the version.
      const whole = await restoreVersion(db, version.id, admin);
      expect(fenced.restoredTables).toBe(whole.restoredTables - 1);
    } finally {
      await done();
    }
  });

  it("a non-admin import of another household's backup keeps no mapping or linked profile naming today's rows", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, exportBackup, importBackup } = await app();
      await household(db, "Theirs", ["ynab", "sec"]);
      const backup = JSON.parse(JSON.stringify(await exportBackup(db)));

      // Today: our own rows and credentials; sec isn't connected here.
      await db.delete(schema.apiConnections);
      await household(db, "Ours", ["ynab", "actual"]);

      await importBackup(db, backup, notAdmin);
      const after = await connections(db);
      expect(after.map((c) => [c.service, c.config])).toEqual([
        ["actual", { accessToken: "Ours-token", budgetId: "b-1" }],
        ["ynab", { accessToken: "Ours-token", budgetId: "b-1" }],
      ]);
      // ynab takes the backup's links; actual, absent from it, has none.
      expect(await linkTargets(db)).toEqual([
        { service: "actual", assets: [], profile: null },
        { service: "ynab", assets: ["Theirs asset"], profile: "Theirs budget" },
      ]);
      expect(after.find((c) => c.service === "ynab")).toMatchObject({
        skippedCategoryIds: ["Theirs-category"],
        linkedColumnIndex: 0,
        serverKnowledge: "Ours".length,
      });
      expect(after.find((c) => c.service === "actual")).toMatchObject({
        accountMappings: null,
        skippedCategoryIds: null,
        linkedColumnIndex: null,
      });
    } finally {
      await done();
    }
  });

  it("an admin's import takes the backup's connections whole", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, exportBackup, importBackup } = await app();
      await household(db, "Theirs", ["ynab", "sec"]);
      const backup = JSON.parse(JSON.stringify(await exportBackup(db)));
      const theirs = await connections(db);
      await db.delete(schema.apiConnections);
      await household(db, "Ours", ["ynab", "actual"]);

      await importBackup(db, backup, admin);
      expect(await connections(db)).toEqual(theirs);
    } finally {
      await done();
    }
  });

  it("an admin's restore brings the version's connections back whole", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, createVersion, restoreVersion } = await app();
      await household(db, "Kept", ["ynab", "actual"]);
      const atVersion = await connections(db);
      const version = await createVersion(db, {
        name: "before",
        type: "manual",
        createdBy: "test",
      });
      await db.delete(schema.apiConnections);
      await household(db, "Later", ["ynab"]);

      await restoreVersion(db, version.id, admin);
      expect(await connections(db)).toEqual(atVersion);
    } finally {
      await done();
    }
  });
}
