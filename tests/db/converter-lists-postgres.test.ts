/**
 * A converter list on PostgreSQL: each converter reads after the one
 * before wrote, dates and timestamps read as text, inserts take the
 * table's sequence, deletes remove one row each (never one other rows
 * still reference), and the replay-twice helper passes them and fails a converter that
 * changes its own output. Only when TEST_DATABASE_URL names a throwaway
 * database (CI's PostgreSQL job): it drops the database's schemas.
 */
// First: its mocks must be in place before any app module loads.
import {
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "../routers/setup-postgres";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import {
  runConverterPg,
  type ConverterTables,
} from "@/lib/db/migrate/migration-converters";
import { expectPgReplaySafe } from "./converter-replay";
import { appends, counts, purges, renames } from "./converter-list-cases";

const TAG = "invented_tag";

describe.skipIf(skipWithoutPostgres)("converter lists (PostgreSQL)", () => {
  let testDb: ReturnType<typeof pointAtTestDatabase>;
  let client: pg.Client;

  beforeAll(async () => {
    testDb = pointAtTestDatabase("converter-lists");
    client = new pg.Client({ connectionString: testDb.url });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await dropAllSchemas(client);
    await client?.end();
    testDb?.restore();
  });
  beforeEach(async () => {
    await dropAllSchemas(client);
    await client.query(
      "CREATE TABLE app_settings (id serial PRIMARY KEY, key text NOT NULL, value text NOT NULL)",
    );
    await client.query(
      "INSERT INTO app_settings (key, value) VALUES ('invented_a', 'x'), ('retired_b', 'y'), ('kept_c', 'z')",
    );
  });
  const rows = async () =>
    (await client.query("SELECT id, key, value FROM app_settings ORDER BY id"))
      .rows;

  it("runs the list in order, each over a fresh read", async () => {
    const run = await runConverterPg(
      client,
      { [TAG]: [renames, counts, purges] },
      TAG,
      "afterSql",
    );
    expect(run).toEqual({ updates: 1, inserts: 1, deletes: 1, notes: [] });
    expect(await rows()).toEqual([
      { id: 1, key: "moved_a", value: "x" },
      { id: 3, key: "kept_c", value: "z" },
      { id: 4, key: "moved_count", value: "1" },
    ]);
  });

  it("reads a date as SQLite's YYYY-MM-DD text and a timestamp as ISO text", async () => {
    await client.query(
      "CREATE TABLE invented_dates (id serial PRIMARY KEY, day date, at timestamptz)",
    );
    await client.query(
      "INSERT INTO invented_dates (day, at) VALUES ('2026-01-31', '2026-01-31 12:30:00+00')",
    );
    const seen: ConverterTables[] = [];
    await runConverterPg(
      client,
      {
        [TAG]: {
          tables: ["invented_dates"],
          runs: "afterSql",
          convert: (t) => {
            seen.push(t);
            return { updates: [], notes: [] };
          },
        },
      },
      TAG,
      "afterSql",
    );
    expect(seen[0]!["invented_dates"]).toEqual([
      { id: 1, day: "2026-01-31", at: "2026-01-31T12:30:00.000Z" },
    ]);
  });

  it("refuses a delete other rows still reference, and passes once the children go first", async () => {
    await client.query(`
      CREATE TABLE parents (id serial PRIMARY KEY);
      CREATE TABLE kids (id serial PRIMARY KEY, parent_id integer REFERENCES parents(id) ON DELETE CASCADE);
      INSERT INTO parents DEFAULT VALUES;
      INSERT INTO kids (parent_id) VALUES (1);
    `);
    const deleting = (deletes: { table: string; id: number }[]) => ({
      [TAG]: {
        tables: ["parents", "kids"],
        runs: "afterSql" as const,
        rowCounts: { shrinks: ["parents", "kids"] },
        convert: () => ({ updates: [], deletes, notes: [] }),
      },
    });
    await expect(
      runConverterPg(
        client,
        deleting([{ table: "parents", id: 1 }]),
        TAG,
        "afterSql",
      ),
    ).rejects.toThrow(
      "Converter delete parents id 1: kids.parent_id still references it",
    );
    expect((await client.query("SELECT id FROM kids")).rows).toEqual([
      { id: 1 },
    ]);
    await runConverterPg(
      client,
      deleting([
        { table: "kids", id: 1 },
        { table: "parents", id: 1 },
      ]),
      TAG,
      "afterSql",
    );
    expect((await client.query("SELECT id FROM parents")).rows).toEqual([]);
  });

  it("the replay-twice helper passes the list and fails a converter that isn't idempotent", async () => {
    await expectPgReplaySafe(client, [renames, counts, purges]);
    await expect(expectPgReplaySafe(client, appends)).rejects.toThrow();
  });
});
