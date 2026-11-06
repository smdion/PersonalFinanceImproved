/**
 * Migration 0015 on PostgreSQL: holding observations lose
 * performance_account_id (with its CHECK, foreign key and indexes), the
 * SimpleFIN link becomes NOT NULL, the dead settings go, and a second run
 * changes nothing; a row with no SimpleFIN account stops it. Runs in its own
 * schema of the throwaway test database, and only when TEST_DATABASE_URL
 * names one (CI's PostgreSQL job).
 */
// First: its mocks must be in place before any app module loads.
import {
  requireThrowawayDatabase,
  skipWithoutPostgres,
} from "../routers/setup-postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import * as fs from "node:fs";
import { DEAD_SETTING_KEYS } from "@/lib/db/v0102-dead-data";

const sql = fs.readFileSync("drizzle/0015_v0102_dead_data.sql", "utf8");
const SCHEMA = "migration_0015_test";

describe.skipIf(skipWithoutPostgres)("migration 0015 on PostgreSQL", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: requireThrowawayDatabase() });
    await client.connect();
  });
  afterAll(async () => {
    await client?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client?.end();
  });

  /** The table as drizzle/0000 builds it, with the parents it points at. */
  async function install() {
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`SET search_path TO ${SCHEMA}`);
    await client.query(`
      CREATE TABLE simplefin_accounts (id serial PRIMARY KEY);
      CREATE TABLE performance_accounts (id serial PRIMARY KEY);
      CREATE TABLE securities (id serial PRIMARY KEY);
      CREATE TABLE app_settings (id serial PRIMARY KEY, key text NOT NULL UNIQUE, value jsonb NOT NULL);
      CREATE TABLE holding_observations (
        id serial PRIMARY KEY,
        simplefin_account_id integer,
        performance_account_id integer,
        security_id integer NOT NULL,
        balance_date timestamp with time zone,
        as_of date NOT NULL,
        shares numeric(20, 8) NOT NULL,
        source text NOT NULL,
        CONSTRAINT holding_observations_one_account_check CHECK ((simplefin_account_id IS NULL) <> (performance_account_id IS NULL))
      );
      ALTER TABLE holding_observations ADD CONSTRAINT holding_observations_simplefin_account_id_simplefin_accounts_id_fk FOREIGN KEY (simplefin_account_id) REFERENCES simplefin_accounts(id) ON DELETE restrict;
      ALTER TABLE holding_observations ADD CONSTRAINT holding_observations_performance_account_id_performance_accounts_id_fk FOREIGN KEY (performance_account_id) REFERENCES performance_accounts(id) ON DELETE restrict;
      CREATE UNIQUE INDEX holding_observations_manual_idx ON holding_observations (performance_account_id, security_id, as_of) WHERE performance_account_id IS NOT NULL;
      CREATE INDEX holding_observations_perf_account_idx ON holding_observations (performance_account_id);
      CREATE INDEX holding_observations_security_idx ON holding_observations (security_id);
      INSERT INTO simplefin_accounts (id) VALUES (3);
      INSERT INTO performance_accounts (id) VALUES (4);
      INSERT INTO securities (id) VALUES (7);
      INSERT INTO holding_observations (id, simplefin_account_id, security_id, as_of, shares, source)
        VALUES (1, 3, 7, '2026-10-30', 12.5, 'simplefin');
    `);
    for (const key of [...DEAD_SETTING_KEYS, "invented_live_key"])
      await client.query(
        "INSERT INTO app_settings (key, value) VALUES ($1, 'true'::jsonb)",
        [key],
      );
  }
  async function exec() {
    for (const stmt of sql.split("--> statement-breakpoint"))
      if (stmt.trim()) await client.query(stmt);
  }
  const state = async () => ({
    columns: (
      await client.query<{ c: string }>(
        `SELECT column_name || ' ' || is_nullable AS c FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'holding_observations' ORDER BY column_name`,
        [SCHEMA],
      )
    ).rows.map((r) => r.c),
    constraints: (
      await client.query<{ n: string }>(
        `SELECT conname AS n FROM pg_constraint c JOIN pg_namespace s ON s.oid = c.connamespace
         WHERE s.nspname = $1 AND conrelid = 'holding_observations'::regclass ORDER BY conname`,
        [SCHEMA],
      )
    ).rows.map((r) => r.n),
    indexes: (
      await client.query<{ n: string }>(
        `SELECT indexname AS n FROM pg_indexes WHERE schemaname = $1 AND tablename = 'holding_observations' ORDER BY indexname`,
        [SCHEMA],
      )
    ).rows.map((r) => r.n),
    rows: (await client.query("SELECT id FROM holding_observations")).rows,
    settings: (await client.query("SELECT key FROM app_settings")).rows,
  });

  it("drops the link and the dead settings, and again on a second run", async () => {
    await install();
    await exec();
    const after = await state();
    expect(after.columns).toContain("simplefin_account_id NO");
    expect(
      after.columns.some((c) => c.startsWith("performance_account_id")),
    ).toBe(false);
    // PostgreSQL keeps 63 bytes of an identifier, so the drizzle name ends early.
    expect(after.constraints).toEqual([
      "holding_observations_pkey",
      "holding_observations_simplefin_account_id_simplefin_accounts_id_fk".slice(
        0,
        63,
      ),
    ]);
    expect(after.indexes).toEqual([
      "holding_observations_pkey",
      "holding_observations_security_idx",
    ]);
    expect(after.rows).toEqual([{ id: 1 }]);
    expect(after.settings).toEqual([{ key: "invented_live_key" }]);
    await exec();
    expect(await state()).toEqual(after);
  });

  it("stops on a row with no SimpleFIN account, inside a transaction", async () => {
    await install();
    await client.query(
      "INSERT INTO holding_observations (id, performance_account_id, security_id, as_of, shares, source) VALUES (2, 4, 7, '2026-10-30', 5, 'manual')",
    );
    const before = await state();
    await client.query("BEGIN");
    await expect(exec()).rejects.toThrow(/null values/);
    await client.query("ROLLBACK");
    expect(await state()).toEqual(before);
  });
});
