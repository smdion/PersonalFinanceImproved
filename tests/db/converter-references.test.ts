/**
 * A converter delete that would leave rows referencing nothing is refused
 * on every path (no cascade or set-null runs for a converter): SQLite and
 * the restore step here, PostgreSQL in converter-lists-postgres.test.ts.
 * A converter that deletes the children first passes. On restore every
 * write is checked before the first one lands. The restore step's foreign
 * keys are the schema's, as the latest snapshot lists them.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  convertBackup,
  runConverterSqlite,
  type DataConverter,
} from "@/lib/db/migrate/migration-converters";
import type { RowDelete } from "@/lib/db/migrate/converter-writes";
import { SCHEMA_REFERENCES } from "@/lib/db/backup/restore-conversions";
import pgJournal from "../../drizzle/meta/_journal.json";

const TAG = "invented_tag";
const REFERENCES = [{ child: "kids", column: "parent_id", parent: "parents" }];

const deleting = (deletes: RowDelete[], updates = false): DataConverter => ({
  tables: ["parents", "kids"],
  runs: "afterSql",
  rowCounts: { shrinks: ["parents", "kids"] },
  convert: () => ({
    updates: updates
      ? [{ table: "parents", id: 1, set: { name: "changed" } }]
      : [],
    deletes,
    notes: [],
  }),
});

const familyDb = () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE parents (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE kids (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id) ON DELETE CASCADE);
    INSERT INTO parents VALUES (1, 'a'), (2, 'b');
    INSERT INTO kids VALUES (10, 1);
  `);
  return db;
};
const family = (): Record<string, unknown[]> => ({
  parents: [
    { id: 1, name: "a" },
    { id: 2, name: "b" },
  ],
  kids: [{ id: 10, parent_id: 1 }],
});

describe("a delete other rows still reference", () => {
  it("SQLite: refused, naming the reference", () => {
    const db = familyDb();
    expect(() =>
      runConverterSqlite(
        db,
        { [TAG]: deleting([{ table: "parents", id: 1 }]) },
        TAG,
        "afterSql",
      ),
    ).toThrow(
      "Converter delete parents id 1: kids.parent_id still references it; a converter deletes those rows first",
    );
    expect(db.prepare("SELECT count(*) AS n FROM kids").get()).toEqual({
      n: 1,
    });
  });

  it("SQLite: passes once the converter deletes the children first", () => {
    const db = familyDb();
    runConverterSqlite(
      db,
      {
        [TAG]: deleting([
          { table: "kids", id: 10 },
          { table: "parents", id: 1 },
        ]),
      },
      TAG,
      "afterSql",
    );
    expect(db.prepare("SELECT id FROM parents").all()).toEqual([{ id: 2 }]);
  });

  it("restore: refused, and no write of that result lands", () => {
    const tables = family();
    expect(() =>
      convertBackup(
        tables,
        { [TAG]: deleting([{ table: "parents", id: 1 }], true) },
        TAG,
        REFERENCES,
      ),
    ).toThrow(/kids\.parent_id still references it/);
    expect(tables).toEqual(family());
  });

  it("restore: passes once the converter deletes the children first", () => {
    const tables = family();
    convertBackup(
      tables,
      {
        [TAG]: deleting([
          { table: "kids", id: 10 },
          { table: "parents", id: 1 },
        ]),
      },
      TAG,
      REFERENCES,
    );
    expect(tables).toEqual({ parents: [{ id: 2, name: "b" }], kids: [] });
  });

  it("restore: a write refused after a delete leaves every row as it was", () => {
    const tables = family();
    const bad: DataConverter = {
      ...deleting([{ table: "parents", id: 2 }]),
      convert: () => ({
        deletes: [{ table: "parents", id: 2 }],
        updates: [{ table: "parents", id: 2, set: { name: "gone" } }],
        notes: [],
      }),
    };
    expect(() => convertBackup(tables, { [TAG]: bad }, TAG)).toThrow(
      /update parents id 2 changed 0 rows, not 1/,
    );
    expect(tables).toEqual(family());
  });
});

describe("the restore step's foreign keys", () => {
  it("are the latest PostgreSQL snapshot's", async () => {
    // By the entry's index, as the migrator finds it: a tag's name can be a
    // placeholder until it lands.
    const idx = String(pgJournal.entries.at(-1)!.idx).padStart(4, "0");
    const snapshot = (await import(
      `../../drizzle/meta/${idx}_snapshot.json`
    )) as {
      tables: Record<
        string,
        {
          foreignKeys: Record<
            string,
            { tableFrom: string; tableTo: string; columnsFrom: string[] }
          >;
        }
      >;
    };
    const fromSnapshot = Object.values(snapshot.tables).flatMap((t) =>
      Object.values(t.foreignKeys).map(
        (fk) => `${fk.tableFrom}.${fk.columnsFrom[0]} -> ${fk.tableTo}`,
      ),
    );
    expect(
      SCHEMA_REFERENCES.map(
        (r) => `${r.child}.${r.column} -> ${r.parent}`,
      ).sort(),
    ).toEqual(fromSnapshot.sort());
    expect(fromSnapshot.length).toBeGreaterThan(0);
  });
});
