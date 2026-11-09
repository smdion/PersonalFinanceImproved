/**
 * A converter list on PostgreSQL: each converter reads after the one
 * before wrote, inserts take the table's sequence, deletes remove one row
 * each, and the replay-twice helper passes them and fails a converter that
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
import { runConverterPg } from "@/lib/db/migrate/migration-converters";
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

  it("the replay-twice helper passes the list and fails a converter that isn't idempotent", async () => {
    await expectPgReplaySafe(client, [renames, counts, purges]);
    await expect(expectPgReplaySafe(client, appends)).rejects.toThrow();
  });
});
