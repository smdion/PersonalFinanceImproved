/**
 * `scripts/export-backup.ts` reads every table from one SQLite snapshot: a
 * write that commits between two tables' reads is in neither.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { VERSION_TABLE_NAMES } from "@/lib/db/version-tables";
import { readTablesSqlite } from "../../scripts/export-backup";

const first = VERSION_TABLE_NAMES[0]!;
const last = VERSION_TABLE_NAMES.at(-1)!;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-export-snapshot-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("backup export snapshot (SQLite)", () => {
  it("leaves out a write that commits between the first and last table's reads", () => {
    const file = path.join(dir, "household.db");
    const writer = new Database(file);
    writer.pragma("journal_mode = WAL");
    writer.exec(
      `CREATE TABLE "${first}" (id INTEGER PRIMARY KEY, note TEXT);
       CREATE TABLE "${last}" (id INTEGER PRIMARY KEY, note TEXT);
       INSERT INTO "${first}" (note) VALUES ('before');`,
    );
    const reader = new Database(file, { readonly: true });
    const writeMidExport = () =>
      writer.exec(
        `INSERT INTO "${first}" (note) VALUES ('during');
         INSERT INTO "${last}" (note) VALUES ('during');`,
      );
    let wrote = false;
    const hooked = new Proxy(reader, {
      get(target, key) {
        if (key === "prepare")
          return (sql: string) => {
            if (!wrote && sql === `SELECT * FROM "${last}"`) {
              writeMidExport();
              wrote = true;
            }
            return target.prepare(sql);
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      const tables = readTablesSqlite(hooked);
      expect(wrote).toBe(true);
      expect(tables[first]).toEqual([{ id: 1, note: "before" }]);
      expect(tables[last]).toEqual([]);
      // The write did land: the next export has it in both tables.
      expect(readTablesSqlite(reader)[last]).toEqual([
        { id: 1, note: "during" },
      ]);
    } finally {
      reader.close();
      writer.close();
    }
  });
});
