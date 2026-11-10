/**
 * JSON column values through a backup import and a version restore, shared
 * by the SQLite and PostgreSQL files: a PostgreSQL backup holds each JSON
 * value parsed (a string scalar, true, a number, an object, JSON null), and
 * each comes back as itself on either database, a JSON null in a NOT NULL
 * column included. Each file supplies `fresh()`.
 *
 * Imports only types from the app: the PostgreSQL file must point
 * DATABASE_URL at its database before the db module is first imported.
 */
import { it, expect } from "vitest";
import { inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as Schema from "@/lib/db/schema";

type Db = NodePgDatabase<typeof Schema>;

export interface JsonValuesDb {
  db: Db;
  done: () => Promise<void> | void;
}

const admin = { asAdmin: true };

/** Invented settings keys, one per JSON value type. */
const VALUES: Record<string, unknown> = {
  invented_json_string: "60000",
  invented_json_text: "plain words",
  invented_json_true: true,
  invented_json_number: 42,
  invented_json_object: { goals: [1, "2"] },
  invented_json_null: null,
};
const KEYS = Object.keys(VALUES);

async function settingsOf(db: Db) {
  const schema = await import("@/lib/db/schema");
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(inArray(schema.appSettings.key, KEYS));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function backupJsonValueCases(fresh: () => Promise<JsonValuesDb>) {
  it("a PostgreSQL backup's JSON values import as themselves, JSON null in a NOT NULL column included", async () => {
    const { db, done } = await fresh();
    try {
      const { exportBackup, importBackup } =
        await import("@/lib/db/backup/version-logic");
      const backup = await exportBackup(db);
      const settings = (backup.tables["app_settings"] ?? []) as {
        id: number;
        key: string;
      }[];
      const nextId = Math.max(0, ...settings.map((r) => r.id)) + 1;
      await importBackup(
        db,
        {
          ...backup,
          sourceDialect: "postgres",
          tables: {
            ...backup.tables,
            app_settings: [
              ...settings,
              ...KEYS.map((key, n) => ({
                id: nextId + n,
                key,
                value: VALUES[key],
              })),
            ],
          },
        },
        admin,
      );
      expect(await settingsOf(db)).toEqual(VALUES);
    } finally {
      await done();
    }
  });

  it("a version restore keeps each JSON value, JSON null in a NOT NULL column included", async () => {
    const { db, done } = await fresh();
    try {
      const { isPostgres } = await import("@/lib/db/dialect");
      const { execRaw } = await import("@/lib/db/compat");
      const { createVersion, restoreVersion } =
        await import("@/lib/db/backup/version-logic");
      for (const key of KEYS) {
        const text = JSON.stringify(VALUES[key]);
        await execRaw(
          db,
          isPostgres()
            ? sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${text}::jsonb)`
            : sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${text})`,
        );
      }
      const version = await createVersion(db, {
        name: "Invented",
        type: "manual",
        createdBy: "test",
      });
      await restoreVersion(db, version.id, admin);
      expect(await settingsOf(db)).toEqual(VALUES);
    } finally {
      await done();
    }
  });
}
