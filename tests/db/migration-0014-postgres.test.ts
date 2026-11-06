/**
 * Migration 0014 on PostgreSQL: the same cases as on SQLite
 * (migration-0014.test.ts) give the same result, and a second run changes
 * nothing. Runs in its own schema of the throwaway test database, and only
 * when TEST_DATABASE_URL names one (CI's PostgreSQL job).
 */
// First: its mocks must be in place before any app module loads.
import {
  requireThrowawayDatabase,
  skipWithoutPostgres,
} from "../routers/setup-postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import * as fs from "node:fs";
import { RENAME_CASES } from "./display-name-custom-cases";

const sql = fs.readFileSync(
  "drizzle/0014_v0102_display_name_custom.sql",
  "utf8",
);
const SCHEMA = "migration_0014_test";

describe.skipIf(skipWithoutPostgres)("migration 0014 on PostgreSQL", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: requireThrowawayDatabase() });
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`SET search_path TO ${SCHEMA}`);
  });
  afterAll(async () => {
    await client?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client?.end();
  });

  async function profiles(values: unknown[]) {
    await client.query("DROP TABLE IF EXISTS contribution_profiles");
    // The live column (drizzle/0000).
    await client.query(
      `CREATE TABLE contribution_profiles (id serial PRIMARY KEY, contribution_active_fields jsonb DEFAULT '{}'::jsonb NOT NULL)`,
    );
    for (const v of values)
      await client.query(
        "INSERT INTO contribution_profiles (contribution_active_fields) VALUES ($1::jsonb)",
        [JSON.stringify(v)],
      );
  }
  async function exec() {
    for (const stmt of sql.split("--> statement-breakpoint"))
      if (stmt.trim()) await client.query(stmt);
  }
  const read = async () =>
    (
      await client.query<{ f: unknown }>(
        "SELECT contribution_active_fields AS f FROM contribution_profiles ORDER BY id",
      )
    ).rows.map((r) => r.f);

  for (const c of RENAME_CASES)
    it(`${c.name}, and again on a second run`, async () => {
      await profiles([c.before]);
      await exec();
      expect(await read()).toEqual([c.after]);
      await exec();
      expect(await read()).toEqual([c.after]);
    });
});
