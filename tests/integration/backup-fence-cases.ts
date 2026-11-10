/**
 * The connections fence on a backup import or version restore, shared by the
 * SQLite and PostgreSQL files: someone who isn't an admin keeps today's
 * credentials (config, server knowledge) and takes the backup's links
 * (mappings, skipped categories, linked profile and column) and last sync
 * time with the backup's rows; an admin takes the backup's connections
 * whole. Each file supplies `fresh()`.
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
  /** The live table's column names. */
  columns: (table: string) => Promise<string[]>;
  done: () => Promise<void> | void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A whole second, so SQLite's seconds column gives it back unchanged. */
const at = (iso: string) => new Date(iso);
const daysAgo = (days: number) =>
  new Date(Math.floor(Date.now() / 1000) * 1000 - days * DAY_MS);

const notAdmin = { asAdmin: false, user: "Viewer" };
const admin = { asAdmin: true, user: "Admin" };

async function app() {
  const schema = await import("@/lib/db/schema");
  const versions = await import("@/lib/db/backup/version-logic");
  return { schema, ...versions };
}

/** An invented asset, budget profile and connection set for one household. */
async function household(
  db: Db,
  label: string,
  services: string[],
  lastSyncedAt: Date | null = null,
) {
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
      lastSyncedAt,
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

/** One local admin and one access setting (an Authentik group mapping),
 *  plus a household setting, for one household. */
async function access(db: Db, label: string) {
  const { schema } = await app();
  await db.delete(schema.localAdmins);
  await db.insert(schema.localAdmins).values({
    email: `${label}@example.test`,
    passwordHash: `${label}-hash`,
    name: label,
  });
  for (const [key, value] of [
    ["rbac_admin_group", `${label}-admins`],
    ["rbac_group_budget", `${label}-budget`],
    ["access_test_household_note", label],
  ] as const) {
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
    await db.insert(schema.appSettings).values({ key, value });
  }
}

async function accessNow(db: Db) {
  const { schema } = await app();
  const admins = await db.select().from(schema.localAdmins);
  const settings = await db.select().from(schema.appSettings);
  const value = (key: string) => settings.find((s) => s.key === key)?.value;
  return {
    admins: admins.map((a) => a.email).sort(),
    adminGroup: value("rbac_admin_group"),
    budgetGroup: value("rbac_group_budget"),
    householdNote: value("access_test_household_note"),
  };
}

async function auditedBy(db: Db, fieldName: string) {
  const { schema } = await app();
  const rows = await db
    .select()
    .from(schema.changeLog)
    .where(eq(schema.changeLog.fieldName, fieldName));
  return rows.map((r) => r.changedBy);
}

/** A backup as SQLite exports it, whatever this suite's dialect: on
 *  PostgreSQL each jsonb value becomes JSON text, as a SQLite export holds it. */
async function asSqliteMade<B extends { tables: Record<string, unknown[]> }>(
  db: Db,
  backup: B,
): Promise<B & { sourceDialect: "sqlite" }> {
  const { rowsInSourceForm } = await import("@/lib/db/backup/restored-values");
  const tables: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(backup.tables))
    tables[name] = await rowsInSourceForm(
      db,
      name,
      rows as Record<string, unknown>[],
      "sqlite",
    );
  return { ...backup, sourceDialect: "sqlite" as const, tables };
}

export function backupFenceCases(fresh: () => Promise<FenceDb>) {
  it("a non-admin restore keeps today's credentials and takes the version's links, so a reused id isn't mapped", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, createVersion, restoreVersion } = await app();
      await household(db, "Kept", ["ynab"], at("2026-03-01T12:00:00Z"));
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
          serverKnowledge: 99,
          lastSyncedAt: at("2026-11-06T12:00:00Z"),
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
      expect(after!.serverKnowledge).toBe(99);
      expect(after!.lastSyncedAt).toEqual(at("2026-03-01T12:00:00Z"));
      expect(await linkTargets(db)).toEqual(atVersion);

      // An asset created now may take the later asset's old id: unmapped.
      const next = await household(db, "Next", []);
      expect(
        (after!.accountMappings ?? []).map((m) => m.assetId),
      ).not.toContain(next.assetId);

      // Its count leaves out the tables it didn't take from the version:
      // the connections and the local admins.
      const whole = await restoreVersion(db, version.id, admin);
      expect(fenced.restoredTables).toBe(whole.restoredTables - 2);
    } finally {
      await done();
    }
  });

  it("a non-admin import of another household's backup keeps no mapping or linked profile naming today's rows", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, exportBackup, importBackup } = await app();
      await household(
        db,
        "Theirs",
        ["ynab", "sec"],
        at("2026-02-01T08:00:00Z"),
      );
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );

      // Today: our own rows and credentials; sec isn't connected here.
      await db.delete(schema.apiConnections);
      await household(
        db,
        "Ours",
        ["ynab", "actual"],
        at("2026-11-01T08:00:00Z"),
      );

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
        lastSyncedAt: at("2026-02-01T08:00:00Z"),
      });
      expect(after.find((c) => c.service === "actual")).toMatchObject({
        accountMappings: null,
        skippedCategoryIds: null,
        linkedColumnIndex: null,
        lastSyncedAt: null,
        serverKnowledge: "Ours".length,
      });
    } finally {
      await done();
    }
  });

  it("an admin's import takes the backup's connections whole", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, exportBackup, importBackup } = await app();
      await household(
        db,
        "Theirs",
        ["ynab", "sec"],
        at("2026-02-01T08:00:00Z"),
      );
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );
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
      await household(
        db,
        "Kept",
        ["ynab", "actual"],
        at("2026-03-01T12:00:00Z"),
      );
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

  it("a non-admin restore takes SimpleFIN's last sync from the version, so today's sync runs and fetches the gap", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, createVersion, restoreVersion } = await app();
      const { hasSyncedToday, transactionWindowStart } =
        await import("@/server/services/sync/simplefin/sync");
      const atVersion = daysAgo(30);
      await household(db, "Kept", ["simplefin"], atVersion);
      const version = await createVersion(db, {
        name: "before",
        type: "manual",
        createdBy: "test",
      });
      await db
        .update(schema.apiConnections)
        .set({ lastSyncedAt: daysAgo(0) })
        .where(eq(schema.apiConnections.service, "simplefin"));
      expect(await hasSyncedToday(db as never, new Date())).toBe(true);

      await restoreVersion(db, version.id, notAdmin);
      const [after] = await connections(db);
      expect(after!.lastSyncedAt).toEqual(atVersion);
      expect(await hasSyncedToday(db as never, new Date())).toBe(false);
      const now = new Date();
      expect(
        transactionWindowStart(after!.lastSyncedAt, now).getTime(),
      ).toBeLessThanOrEqual(atVersion.getTime());
    } finally {
      await done();
    }
  });

  it("a non-admin import keeps today's local admins and access settings, and takes the household's settings", async () => {
    const { db, done } = await fresh();
    try {
      const { exportBackup, importBackup } = await app();
      await access(db, "theirs");
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );
      await access(db, "ours");

      await importBackup(db, backup, notAdmin);
      expect(await accessNow(db)).toEqual({
        admins: ["ours@example.test"],
        adminGroup: "ours-admins",
        budgetGroup: "ours-budget",
        householdNote: "theirs",
      });
      expect(await auditedBy(db, "import")).toEqual(["Viewer"]);
    } finally {
      await done();
    }
  });

  it("a non-admin restore keeps today's local admins and access settings", async () => {
    const { db, done } = await fresh();
    try {
      const { createVersion, restoreVersion } = await app();
      await access(db, "then");
      const version = await createVersion(db, {
        name: "before",
        type: "manual",
        createdBy: "someone else",
      });
      await access(db, "now");

      await restoreVersion(db, version.id, notAdmin);
      expect(await accessNow(db)).toEqual({
        admins: ["now@example.test"],
        adminGroup: "now-admins",
        budgetGroup: "now-budget",
        householdNote: "then",
      });
      // The change log names who restored, not who made the version.
      expect(await auditedBy(db, "restore")).toEqual(["Viewer"]);
    } finally {
      await done();
    }
  });

  it("an admin's import takes the backup's local admins and access settings", async () => {
    const { db, done } = await fresh();
    try {
      const { exportBackup, importBackup } = await app();
      await access(db, "theirs");
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );
      await access(db, "ours");

      await importBackup(db, backup, admin);
      expect(await accessNow(db)).toEqual({
        admins: ["theirs@example.test"],
        adminGroup: "theirs-admins",
        budgetGroup: "theirs-budget",
        householdNote: "theirs",
      });
      expect(await auditedBy(db, "import")).toEqual(["Admin"]);
    } finally {
      await done();
    }
  });

  it("an admin's backup with no local admin keeps today's, so the first-admin gate can't reopen through it", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, exportBackup, importBackup } = await app();
      const { firstRunState, settleFirstRunGate } =
        await import("@/server/data/first-run");
      await access(db, "theirs");
      await db.delete(schema.localAdmins);
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );
      await access(db, "ours");

      await importBackup(db, backup, admin);
      await settleFirstRunGate(db as never, "import");
      expect((await accessNow(db)).admins).toEqual(["ours@example.test"]);
      expect(await firstRunState(db as never)).toEqual({ adminNeeded: false });
    } finally {
      await done();
    }
  });

  it("a non-admin's export carries no logins, access settings or credentials", async () => {
    const { db, done } = await fresh();
    try {
      const { exportBackup } = await app();
      await access(db, "ours");
      await household(db, "Ours", ["ynab"], at("2026-03-01T12:00:00Z"));
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: false })),
      );

      expect(backup.householdOnly).toBe(true);
      expect(backup.tables).not.toHaveProperty("local_admins");
      const keys = backup.tables.app_settings.map(
        (r: { key: string }) => r.key,
      );
      expect(keys).toContain("access_test_household_note");
      expect(keys.filter((k: string) => k.startsWith("rbac_"))).toEqual([]);
      const [ynab] = backup.tables.api_connections;
      expect(Object.keys(ynab).sort()).toEqual(
        [
          "service",
          "account_mappings",
          "skipped_category_ids",
          "linked_profile_id",
          "linked_column_index",
          "last_synced_at",
        ].sort(),
      );
      expect(JSON.stringify(backup)).not.toContain("Ours-token");
      expect(JSON.stringify(backup)).not.toContain("ours-hash");
    } finally {
      await done();
    }
  });

  it("an admin importing a non-admin's export keeps today's logins, access settings and credentials", async () => {
    const { db, done } = await fresh();
    try {
      const { exportBackup, importBackup } = await app();
      await access(db, "theirs");
      await household(db, "Theirs", ["ynab"], at("2026-03-01T12:00:00Z"));
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: false })),
      );
      await access(db, "ours");
      const { schema } = await app();
      await db
        .update(schema.apiConnections)
        .set({ config: { accessToken: "today-token", budgetId: "b-1" } });

      await importBackup(db, backup, admin);
      expect(await accessNow(db)).toEqual({
        admins: ["ours@example.test"],
        adminGroup: "ours-admins",
        budgetGroup: "ours-budget",
        householdNote: "theirs",
      });
      const [ynab] = await connections(db);
      expect(ynab!.config).toEqual({
        accessToken: "today-token",
        budgetId: "b-1",
      });
      expect(ynab!.lastSyncedAt).toEqual(at("2026-03-01T12:00:00Z"));
    } finally {
      await done();
    }
  });

  it("a non-admin import of a PostgreSQL-made backup keeps today's access settings as themselves (on SQLite: across dialects)", async () => {
    const { db, done } = await fresh();
    try {
      const { exportBackup, importBackup } = await app();
      const { isPostgres } = await import("@/lib/db/dialect");
      await access(db, "theirs");
      const exported = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );
      // As PostgreSQL exports it: each setting's JSON value parsed.
      const asRead = (v: unknown) =>
        !isPostgres() && typeof v === "string" ? JSON.parse(v) : v;
      const backup = {
        ...exported,
        sourceDialect: "postgres" as const,
        tables: {
          ...exported.tables,
          app_settings: exported.tables.app_settings.map(
            (r: { value: unknown }) => ({ ...r, value: asRead(r.value) }),
          ),
        },
      };
      await access(db, "ours");

      await importBackup(db, backup, notAdmin);
      expect(await accessNow(db)).toEqual({
        admins: ["ours@example.test"],
        adminGroup: "ours-admins",
        budgetGroup: "ours-budget",
        householdNote: "theirs",
      });
    } finally {
      await done();
    }
  });

  it("a setting an older import stored unquoted reads as its string, so a PostgreSQL-made backup still imports and writes it back quoted (SQLite)", async () => {
    const { db, done } = await fresh();
    try {
      const { isPostgres } = await import("@/lib/db/dialect");
      if (isPostgres()) return; // jsonb can't hold unquoted text
      const { sql } = await import("drizzle-orm");
      const { execRaw } = await import("@/lib/db/compat");
      const { exportBackup, importBackup } = await app();
      await access(db, "theirs");
      const exported = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );
      const backup = {
        ...exported,
        sourceDialect: "postgres" as const,
        tables: {
          ...exported.tables,
          app_settings: exported.tables.app_settings.map(
            (r: { value: unknown }) => ({
              ...r,
              value:
                typeof r.value === "string" ? JSON.parse(r.value) : r.value,
            }),
          ),
        },
      };
      await access(db, "ours");
      await execRaw(
        db,
        sql`UPDATE app_settings SET value = 'ours-admins' WHERE key = 'rbac_admin_group'`,
      );

      await importBackup(db, backup, notAdmin);
      expect((await accessNow(db)).adminGroup).toBe("ours-admins");
    } finally {
      await done();
    }
  });

  it("a non-admin import of a SQLite-made backup keeps today's access and credentials in the backup's form (on PostgreSQL: across dialects)", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, exportBackup, importBackup } = await app();
      await access(db, "theirs");
      await household(db, "Theirs", ["ynab"], at("2026-03-01T12:00:00Z"));
      const backup = await asSqliteMade(
        db,
        JSON.parse(JSON.stringify(await exportBackup(db, { asAdmin: true }))),
      );
      await access(db, "ours");
      await db
        .update(schema.apiConnections)
        .set({ config: { accessToken: "today-token", budgetId: "b-1" } });

      await importBackup(db, backup, notAdmin);
      expect(await accessNow(db)).toEqual({
        admins: ["ours@example.test"],
        adminGroup: "ours-admins",
        budgetGroup: "ours-budget",
        householdNote: "theirs",
      });
      const [ynab] = await connections(db);
      expect(ynab!.config).toEqual({
        accessToken: "today-token",
        budgetId: "b-1",
      });
      expect(await linkTargets(db)).toEqual([
        { service: "ynab", assets: ["Theirs asset"], profile: "Theirs budget" },
      ]);
    } finally {
      await done();
    }
  });

  it("a gate closed only because people exist (no flag) stays closed through a backup holding false and no people, with no settle", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, exportBackup, importBackup } = await app();
      const { firstRunState } = await import("@/server/data/first-run");
      await db.delete(schema.localAdmins); // an Authentik-only install
      await db
        .insert(schema.appSettings)
        .values({ key: "onboarding_completed", value: false });
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );
      await db
        .delete(schema.appSettings)
        .where(eq(schema.appSettings.key, "onboarding_completed"));
      await db
        .insert(schema.people)
        .values({ name: "Robin", dateOfBirth: "1990-06-15" });
      expect(await firstRunState(db as never)).toEqual({ adminNeeded: false });

      for (const by of [admin, notAdmin]) {
        await importBackup(db, backup, by);
        expect(await firstRunState(db as never)).toEqual({
          adminNeeded: false,
        });
      }
    } finally {
      await done();
    }
  });

  it("a gate open on purpose (flag false) isn't closed by a restore", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, exportBackup, importBackup } = await app();
      const { firstRunState } = await import("@/server/data/first-run");
      await db.delete(schema.localAdmins);
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );
      await db
        .insert(schema.people)
        .values({ name: "Robin", dateOfBirth: "1990-06-15" });
      await db
        .insert(schema.appSettings)
        .values({ key: "onboarding_completed", value: false });
      await importBackup(db, backup, admin);
      expect(await firstRunState(db as never)).toEqual({ adminNeeded: true });
    } finally {
      await done();
    }
  });

  it("settings kept from today take fresh ids, so a backup from another install whose ids overlap still imports", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, exportBackup, importBackup } = await app();
      await access(db, "ours");
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );
      // The other install's settings reuse today's access rows' ids.
      const ids = (await db.select().from(schema.appSettings))
        .filter((r) => r.key.startsWith("rbac_"))
        .map((r) => r.id);
      backup.tables.app_settings = ids.map((id: number, i: number) => ({
        ...backup.tables.app_settings.find(
          (r: { key: string }) => r.key === "access_test_household_note",
        ),
        id,
        key: `other_install_${i}`,
      }));
      await importBackup(db, backup, notAdmin);
      expect(await accessNow(db)).toMatchObject({
        adminGroup: "ours-admins",
        budgetGroup: "ours-budget",
      });
    } finally {
      await done();
    }
  });

  it("a finished onboarding stays finished through any backup, so even the CLI (which settles no gate) can't reopen the first-admin gate", async () => {
    const { db, done } = await fresh();
    try {
      const {
        schema,
        exportBackup,
        importBackup,
        createVersion,
        restoreVersion,
      } = await app();
      const { firstRunState } = await import("@/server/data/first-run");
      const setOnboarding = async (value: boolean) => {
        await db
          .delete(schema.appSettings)
          .where(eq(schema.appSettings.key, "onboarding_completed"));
        await db
          .insert(schema.appSettings)
          .values({ key: "onboarding_completed", value });
      };
      await db.delete(schema.localAdmins); // an Authentik-only install
      await setOnboarding(false);
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );
      const version = await createVersion(db, {
        name: "before onboarding",
        type: "manual",
        createdBy: "test",
      });
      await setOnboarding(true);

      for (const by of [admin, notAdmin]) {
        await importBackup(db, backup, by);
        expect(await firstRunState(db as never)).toEqual({
          adminNeeded: false,
        });
        await restoreVersion(db, version.id, by);
        expect(await firstRunState(db as never)).toEqual({
          adminNeeded: false,
        });
      }
    } finally {
      await done();
    }
  });

  it("a non-admin restore keeps today's mappings and linked column where they name the same restored row, and takes the version's elsewhere", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, createVersion, restoreVersion } = await app();
      const { assetId, profileId } = await household(db, "Kept", ["ynab"]);
      await db
        .update(schema.budgetProfiles)
        .set({ columnLabels: ["Standard", "Lean"] })
        .where(eq(schema.budgetProfiles.id, profileId));
      const [renamed] = await db
        .insert(schema.otherAssetItems)
        .values({ name: "Old name", year: 2026, value: "1.00" })
        .returning();
      const version = await createVersion(db, {
        name: "before",
        type: "manual",
        createdBy: "test",
      });

      // Today: the same asset mapped both ways, Cash mapped, the Lean column
      // linked, and the second asset renamed (so it isn't the same row).
      await db
        .update(schema.otherAssetItems)
        .set({ name: "New name" })
        .where(eq(schema.otherAssetItems.id, renamed!.id));
      await db
        .update(schema.apiConnections)
        .set({
          accountMappings: [
            {
              localName: "Kept asset",
              remoteAccountId: "Kept-remote",
              syncDirection: "both",
              assetId,
            },
            {
              localId: "cash",
              localName: "Cash",
              remoteAccountId: "checking",
              syncDirection: "pull",
            },
            {
              localName: "New name",
              remoteAccountId: "renamed-remote",
              syncDirection: "pull",
              assetId: renamed!.id,
            },
          ],
          linkedColumnIndex: 1,
        })
        .where(eq(schema.apiConnections.service, "ynab"));

      await restoreVersion(db, version.id, notAdmin);
      const [after] = await connections(db);
      expect(
        (after!.accountMappings ?? []).map((m) => [
          m.remoteAccountId,
          m.syncDirection,
        ]),
      ).toEqual([
        ["Kept-remote", "both"],
        ["checking", "pull"],
      ]);
      expect(after!.linkedProfileId).toBe(profileId);
      expect(after!.linkedColumnIndex).toBe(1);

      // A column whose label changed since is not the same column.
      await db
        .update(schema.budgetProfiles)
        .set({ columnLabels: ["Standard", "Renamed"] })
        .where(eq(schema.budgetProfiles.id, profileId));
      await restoreVersion(db, version.id, notAdmin);
      const [again] = await connections(db);
      expect(again!.linkedColumnIndex).toBe(0);
    } finally {
      await done();
    }
  });

  it("an import's restoredTables counts the tables it takes from the backup", async () => {
    const { db, done } = await fresh();
    try {
      const { exportBackup, importBackup } = await app();
      const { VERSION_TABLE_NAMES } =
        await import("@/lib/db/backup/version-tables");
      await access(db, "ours");
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db, { asAdmin: true })),
      );
      const whole = await importBackup(db, backup, admin);
      expect(whole.restoredTables).toBe(VERSION_TABLE_NAMES.length);
      // Not the local admins or the connections, kept from today.
      const fenced = await importBackup(db, backup, notAdmin);
      expect(fenced.restoredTables).toBe(whole.restoredTables - 2);
      // A backup lacking a table doesn't count it.
      delete backup.tables.securities;
      const partial = await importBackup(db, backup, admin);
      expect(partial.restoredTables).toBe(whole.restoredTables - 1);
      // Nor the local admins it lacks, kept from today.
      delete backup.tables.local_admins;
      const noAdmins = await importBackup(db, backup, admin);
      expect(noAdmins.restoredTables).toBe(whole.restoredTables - 2);
    } finally {
      await done();
    }
  });

  it("every column of each installation table is kept, matched or taken from the backup, on one list only", async () => {
    const { columns, done } = await fresh();
    try {
      const { VERSION_TABLES } = await import("@/lib/db/backup/version-tables");
      const { INSTALLATION_COLUMNS } =
        await import("@/lib/db/backup/installation-rows");
      const tables = VERSION_TABLES.filter((t) => t.scope === "installation");
      expect(tables.length).toBeGreaterThan(0);
      for (const { name } of tables) {
        const listed = INSTALLATION_COLUMNS[name];
        expect(listed, name).toBeDefined();
        const sides = [
          ...listed!.kept,
          ...listed!.matched,
          ...listed!.fromBackup,
        ];
        expect(new Set(sides).size, `${name}: a column on both lists`).toBe(
          sides.length,
        );
        expect([...sides].sort(), name).toEqual((await columns(name)).sort());
        expect(listed!.kept, name).toContain(listed!.key);
      }
    } finally {
      await done();
    }
  });
}
