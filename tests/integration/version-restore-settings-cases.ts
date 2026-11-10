/**
 * A version restore brings each app setting back in its stored form, shared
 * by the SQLite and PostgreSQL files: a string that also reads as JSON
 * ("60000", "false") stays a string, a plain string isn't refused, and a
 * number, a boolean and an object stay what they were.
 *
 * Imports only types from the app (see ./backup-fence-cases).
 */
import { it, expect } from "vitest";
import { inArray } from "drizzle-orm";
import type { FenceDb } from "./backup-fence-cases";

const SETTINGS: Record<string, unknown> = {
  restore_numeric_string: "60000",
  restore_false_string: "false",
  restore_stamp: "2026-09-05T22:04:49.000Z",
  restore_number: 42,
  restore_false: false,
  restore_object: { goals: [1, "2"] },
};

export function versionRestoreSettingsCases(fresh: () => Promise<FenceDb>) {
  it("a restore brings every setting back in its stored form", async () => {
    const { db, done } = await fresh();
    try {
      const schema = await import("@/lib/db/schema");
      const { createVersion, restoreVersion } =
        await import("@/lib/db/backup/version-logic");
      const keys = Object.keys(SETTINGS);
      await db
        .insert(schema.appSettings)
        .values(
          Object.entries(SETTINGS).map(([key, value]) => ({ key, value })),
        );
      const version = await createVersion(db, {
        name: "before",
        type: "manual",
        createdBy: "test",
      });
      await db
        .delete(schema.appSettings)
        .where(inArray(schema.appSettings.key, keys));

      await restoreVersion(db, version.id, { asAdmin: true, user: "Admin" });
      const rows = await db
        .select({
          key: schema.appSettings.key,
          value: schema.appSettings.value,
        })
        .from(schema.appSettings)
        .where(inArray(schema.appSettings.key, keys));
      expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toEqual(
        SETTINGS,
      );
    } finally {
      await done();
    }
  });
}
