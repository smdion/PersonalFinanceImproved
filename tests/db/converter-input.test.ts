/**
 * What a converter gets: its tables as a deep-frozen copy on every path
 * (changing one in place throws; a restore's written
 * values are the backup's own), and a tag's beforeSql converters ahead of
 * its afterSql ones, so the restore runs them in the live order.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  convertBackup,
  runConverterPg,
  runConverterSqlite,
  tagConverters,
  type DataConverter,
} from "@/lib/db/migrate/migration-converters";
import { over, renames } from "./converter-list-cases";

const TAG = "invented_tag";

/** Changes the first row it reads in place, then asks for nothing. */
const mutates: DataConverter = {
  tables: ["app_settings"],
  runs: "afterSql",
  convert: (t) => {
    const first = t["app_settings"]?.[0];
    if (first && typeof first === "object")
      Object.assign(first, { key: "changed" });
    return { updates: [], notes: [] };
  },
};

const settingsDb = () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, key TEXT, value TEXT)",
  );
  db.exec("INSERT INTO app_settings VALUES (1, 'invented_a', 'x')");
  return db;
};

describe("a converter's tables are frozen", () => {
  it("SQLite: changing a row in place throws", () => {
    const db = settingsDb();
    expect(() =>
      runConverterSqlite(db, { [TAG]: [renames, mutates] }, TAG, "afterSql"),
    ).toThrow(TypeError);
  });

  it("PostgreSQL: the same", async () => {
    const client = {
      query: async (sql: string) =>
        sql.startsWith("SELECT *")
          ? { rows: [{ id: 1, key: "invented_a", value: "x" }] }
          : { rows: [{ present: true }], rowCount: 1 },
    };
    await expect(
      runConverterPg(client, { [TAG]: mutates }, TAG, "afterSql"),
    ).rejects.toThrow(TypeError);
  });

  it("restore: the same, the backup untouched; written values are the backup's own, not frozen", () => {
    const tables: Record<string, unknown[]> = {
      app_settings: [{ id: 1, key: "invented_a", value: { n: 1 } }],
    };
    expect(() => convertBackup(tables, { [TAG]: mutates }, TAG)).toThrow(
      TypeError,
    );
    expect(tables["app_settings"]).toEqual([
      { id: 1, key: "invented_a", value: { n: 1 } },
    ]);
    const copies = over((rows) => ({
      updates: rows.map((r) => ({
        table: "app_settings",
        id: r.id,
        set: { value: { kept: r.value } },
      })),
      inserts: [],
    }));
    convertBackup(tables, { [TAG]: copies }, TAG);
    const row = tables["app_settings"]![0] as { value: object };
    expect(row.value).toEqual({ kept: { n: 1 } });
    expect(Object.isFrozen(row.value)).toBe(false);
    expect(Object.isFrozen((row.value as { kept: object }).kept)).toBe(false);
  });
});

describe("a tag's converter order", () => {
  const before = over(() => ({ updates: [] }), "beforeSql");
  const after = over(() => ({ updates: [] }), "afterSql");

  it("takes beforeSql converters ahead of afterSql ones", () => {
    expect(tagConverters(TAG, { [TAG]: [before, before, after] })).toEqual([
      before,
      before,
      after,
    ]);
  });

  it("refuses a beforeSql converter after an afterSql one", () => {
    expect(() => tagConverters(TAG, { [TAG]: [after, before] })).toThrow(
      /beforeSql converters must come before its afterSql ones/,
    );
  });
});
