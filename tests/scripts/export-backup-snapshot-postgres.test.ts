/**
 * `scripts/export-backup.ts` reads every table from one PostgreSQL snapshot
 * (REPEATABLE READ READ ONLY): a write that commits between two tables'
 * reads is in neither.
 *
 * Runs only when TEST_DATABASE_URL names a throwaway database (its name
 * must end in `_test`): it drops and rebuilds the public schema. CI runs it
 * in the PostgreSQL job.
 */
// First: its mocks must be in place before any app module loads.
import {
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "../routers/setup-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { VERSION_TABLE_NAMES } from "@/lib/db/backup/version-tables";
import { readTablesPostgres } from "../../scripts/export-backup";

const first = VERSION_TABLE_NAMES[0]!;
const last = VERSION_TABLE_NAMES.at(-1)!;

describe.skipIf(skipWithoutPostgres)(
  "backup export snapshot (PostgreSQL)",
  () => {
    let restoreEnv: () => void = () => {};
    let writer: pg.Client;
    let reader: pg.Client;

    beforeAll(async () => {
      const testDatabase = pointAtTestDatabase("export-snapshot-pg");
      restoreEnv = testDatabase.restore;
      writer = new pg.Client({ connectionString: testDatabase.url });
      reader = new pg.Client({ connectionString: testDatabase.url });
      await writer.connect();
      await reader.connect();
      await dropAllSchemas(writer);
    });

    afterAll(async () => {
      await reader?.end();
      if (writer) {
        await dropAllSchemas(writer);
        await writer.end();
      }
      restoreEnv();
    });

    it("leaves out a write that commits between the first and last table's reads", async () => {
      await writer.query(
        `CREATE TABLE "${first}" (id serial PRIMARY KEY, note text);
       CREATE TABLE "${last}" (id serial PRIMARY KEY, note text);
       INSERT INTO "${first}" (note) VALUES ('before');`,
      );
      let wrote = false;
      const hooked = new Proxy(reader, {
        get(target, key) {
          if (key === "query")
            return async (sql: string, values?: unknown[]) => {
              if (!wrote && sql === `SELECT * FROM "${last}"`) {
                await writer.query(
                  `INSERT INTO "${first}" (note) VALUES ('during');
                 INSERT INTO "${last}" (note) VALUES ('during');`,
                );
                wrote = true;
              }
              return target.query(sql, values);
            };
          const value: unknown = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      const tables = await readTablesPostgres(hooked);
      expect(wrote).toBe(true);
      expect(tables[first]).toEqual([{ id: 1, note: "before" }]);
      expect(tables[last]).toEqual([]);
      // The write did land, and the reader's transaction is closed: the next
      // export has it in both tables.
      expect((await readTablesPostgres(reader))[last]).toEqual([
        { id: 1, note: "during" },
      ]);
    });
  },
);
